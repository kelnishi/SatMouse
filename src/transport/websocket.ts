import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { SpatialData, ButtonEvent, DeviceInfo } from "../devices/types.js";
import { isLoopbackAddress, type FocusTracker } from "../focus.js";
import { encodeSpatialBinary } from "./spatial-binary.js";

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
  /** Peer is on this machine; only local peers may report focus */
  local: boolean;
}

/**
 * WebSocket server for streaming spatial data (fallback when WebTransport
 * is unavailable). Supports two subprotocols:
 *
 * - satmouse-json:   JSON text frames (default)
 * - satmouse-binary: Same binary frames as WebTransport datagrams
 *
 * The only client→bridge message is a JSON text frame reporting page focus
 * (`{"type":"focus","focused":true}`), accepted from local peers on either
 * subprotocol. See docs/protocol.md.
 */
export class SatMouseWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<ClientSession>();
  private port: number;
  private getDevices: (() => DeviceInfo[]) | null = null;
  private focus: FocusTracker | null = null;

  constructor(port: number) {
    this.port = port;
  }

  /** Set a callback to get the current device list (sent to new clients on connect) */
  setDeviceProvider(fn: () => DeviceInfo[]): void {
    this.getDevices = fn;
  }

  /** Set the tracker that receives client focus reports */
  setFocusTracker(focus: FocusTracker): void {
    this.focus = focus;
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
      const local = isLoopbackAddress(req.socket.remoteAddress);
      const session: ClientSession = { ws, subprotocol, origin, userAgent, local };
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

      // Clients may only report focus; everything else is dropped
      ws.on("message", (data, isBinary) => {
        if (isBinary || !session.local || !this.focus) return;
        const focused = parseFocusMessage(data.toString());
        if (focused !== null) this.focus.set(session, focused);
      });

      ws.on("close", () => {
        this.clients.delete(session);
        this.focus?.remove(session);
        console.log(`[WebSocket] Client disconnected (${this.clients.size} total)`);
      });

      ws.on("error", () => {
        this.clients.delete(session);
        this.focus?.remove(session);
      });
    });

    console.log(`[WebSocket] Listening on ws://0.0.0.0:${this.port}/spatial`);
  }

  broadcastSpatialData(data: SpatialData): void {
    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;

      try {
        if (client.subprotocol === SUBPROTOCOL_BINARY) {
          client.ws.send(encodeSpatialBinary(data, 0x01));
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
      // The Safari extension connects from its background script. Current
      // Safari sends the extension's own origin; earlier versions sent none.
      extension: c.origin.startsWith("safari-web-extension://") ||
        (c.origin === "" && c.userAgent.includes("Safari") && !c.userAgent.includes("Chrome")),
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
    for (const client of this.clients) this.focus?.remove(client);
    this.clients.clear();
    console.log("[WebSocket] Stopped");
  }
}

/** Parse a `{"type":"focus","focused":boolean}` message; null if it is anything else */
export function parseFocusMessage(text: string): boolean | null {
  if (text.length > 256) return null;
  try {
    const msg = JSON.parse(text);
    if (msg?.type === "focus" && typeof msg.focused === "boolean") return msg.focused;
  } catch {}
  return null;
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
