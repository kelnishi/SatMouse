import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { SpatialData, ButtonEvent, DeviceInfo } from "../devices/types.js";

const SUBPROTOCOL_JSON = "satmouse-json";
const SUBPROTOCOL_BINARY = "satmouse-binary";
const VALID_SUBPROTOCOLS = new Set([SUBPROTOCOL_JSON, SUBPROTOCOL_BINARY]);
const MAX_CLIENTS = 32;
const MAX_FRAME_SIZE = 65536; // 64KB

interface ClientSession {
  ws: WebSocket;
  subprotocol: string;
  origin: string;
  userAgent: string;
}

/**
 * WebSocket server for streaming spatial data (fallback when WebTransport
 * is unavailable). Supports two subprotocols:
 *
 * - satmouse-json:   JSON text frames (default)
 * - satmouse-binary: Same 24-byte binary format as WebTransport datagrams
 */
export class SatMouseWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<ClientSession>();
  private port: number;
  private getDevices: (() => DeviceInfo[]) | null = null;

  constructor(port: number) {
    this.port = port;
  }

  /** Set a callback to get the current device list (sent to new clients on connect) */
  setDeviceProvider(fn: () => DeviceInfo[]): void {
    this.getDevices = fn;
  }

  start(httpServer?: any): void {
    this.wss = new WebSocketServer({
      port: httpServer ? undefined : this.port,
      server: httpServer,
      path: "/spatial",
      maxPayload: MAX_FRAME_SIZE,
      handleProtocols: (protocols: Set<string>) => {
        if (protocols.has(SUBPROTOCOL_BINARY)) return SUBPROTOCOL_BINARY;
        if (protocols.has(SUBPROTOCOL_JSON)) return SUBPROTOCOL_JSON;
        // Reject unknown subprotocols
        return false as any;
      },
    });

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      // Connection limit
      if (this.clients.size >= MAX_CLIENTS) {
        console.warn(`[WebSocket] Rejected connection (limit ${MAX_CLIENTS})`);
        ws.close(1013, "Maximum connections reached");
        return;
      }

      const subprotocol = ws.protocol || SUBPROTOCOL_JSON;
      if (!VALID_SUBPROTOCOLS.has(subprotocol)) {
        ws.close(1002, "Invalid subprotocol");
        return;
      }

      // Capture and sanitize client info (truncate to prevent abuse)
      const origin = (req.headers.origin ?? "").toString().slice(0, 256);
      const userAgent = (req.headers["user-agent"] ?? "").toString().slice(0, 512);
      const session: ClientSession = { ws, subprotocol, origin, userAgent };
      this.clients.add(session);

      console.log(`[WebSocket] Client connected (${subprotocol}, ${this.clients.size} total) from ${origin || "unknown"}`);

      // Send current device list so clients don't need a separate HTTP fetch
      if (this.getDevices) {
        for (const device of this.getDevices()) {
          try {
            ws.send(JSON.stringify({ type: "deviceStatus", data: { event: "connected", device, timestamp: performance.now() * 1000 } }));
          } catch {}
        }
      }

      // Bridge is send-only — drop any data received from clients
      ws.on("message", () => {
        // Silently ignore client messages — bridge doesn't accept input over WebSocket
      });

      ws.on("close", () => {
        this.clients.delete(session);
        console.log(`[WebSocket] Client disconnected (${this.clients.size} total)`);
      });

      ws.on("error", () => {
        this.clients.delete(session);
      });
    });

    console.log(`[WebSocket] Listening on ws://0.0.0.0:${this.port}/spatial`);
  }

  broadcastSpatialData(data: SpatialData): void {
    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;

      try {
        if (client.subprotocol === SUBPROTOCOL_BINARY) {
          client.ws.send(encodeSpatialBinary(data));
        } else {
          client.ws.send(JSON.stringify({ type: "spatialData", data }));
        }
      } catch {
        // Will be cleaned up on close
      }
    }
  }

  getClientInfo(): Array<{ transport: string; subprotocol: string; origin: string; browser: string; extension: boolean }> {
    return [...this.clients].filter(c => c.ws.readyState === WebSocket.OPEN).map(c => ({
      transport: "websocket",
      subprotocol: c.subprotocol,
      origin: c.origin,
      browser: parseBrowser(c.userAgent),
      // Extension clients connect from the background script (no origin, node-like UA)
      extension: c.origin === "" && c.userAgent.includes("Safari") && !c.userAgent.includes("Chrome"),
    }));
  }

  broadcastButtonEvent(data: ButtonEvent): void {
    const json = JSON.stringify({ type: "buttonEvent", data });
    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      try {
        client.ws.send(json);
      } catch {}
    }
  }

  broadcastDeviceStatus(event: string, device: DeviceInfo): void {
    const json = JSON.stringify({
      type: "deviceStatus",
      data: { event, device, timestamp: performance.now() * 1000 },
    });
    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      try {
        client.ws.send(json);
      } catch {}
    }
  }

  stop(): void {
    this.wss?.close();
    this.clients.clear();
    console.log("[WebSocket] Stopped");
  }
}

/** Parse a user-agent string into a short browser name */
function parseBrowser(ua: string): string {
  if (!ua) return "Unknown";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("OPR/") || ua.includes("Opera")) return "Opera";
  if (ua.includes("Chrome/") && !ua.includes("Edg/")) return "Chrome";
  if (ua.includes("Safari/") && !ua.includes("Chrome")) return "Safari";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("node")) return "Node.js";
  return "Unknown";
}

/** Clamp a number to int16 range, reject NaN/Infinity */
function clampInt16(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-32768, Math.min(32767, Math.round(v)));
}

function encodeSpatialBinary(data: SpatialData): Buffer {
  const buf = Buffer.allocUnsafe(25);
  buf.writeUInt8(0x01, 0); // type prefix: spatial data
  buf.writeDoubleLE(Number.isFinite(data.timestamp) ? data.timestamp : 0, 1);
  buf.writeInt16LE(clampInt16(data.translation.x), 9);
  buf.writeInt16LE(clampInt16(data.translation.y), 11);
  buf.writeInt16LE(clampInt16(data.translation.z), 13);
  buf.writeInt16LE(clampInt16(data.rotation.x), 15);
  buf.writeInt16LE(clampInt16(data.rotation.y), 17);
  buf.writeInt16LE(clampInt16(data.rotation.z), 19);
  buf.writeUInt32LE(0, 21);
  return buf;
}
