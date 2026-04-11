import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { SpatialData, ButtonEvent, DeviceInfo } from "../devices/types.js";

const SUBPROTOCOL_JSON = "satmouse-json";
const SUBPROTOCOL_BINARY = "satmouse-binary";

interface ClientSession {
  ws: WebSocket;
  subprotocol: string;
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

  constructor(port: number) {
    this.port = port;
  }

  start(httpServer?: any): void {
    this.wss = new WebSocketServer({
      port: httpServer ? undefined : this.port,
      server: httpServer,
      path: "/spatial",
      handleProtocols: (protocols: Set<string>) => {
        if (protocols.has(SUBPROTOCOL_BINARY)) return SUBPROTOCOL_BINARY;
        return SUBPROTOCOL_JSON;
      },
    });

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const subprotocol = ws.protocol || SUBPROTOCOL_JSON;
      const session: ClientSession = { ws, subprotocol };
      this.clients.add(session);

      console.log(`[WebSocket] Client connected (${subprotocol}, ${this.clients.size} total)`);

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

function encodeSpatialBinary(data: SpatialData): Buffer {
  const buf = Buffer.allocUnsafe(25);
  buf.writeUInt8(0x01, 0); // type prefix: spatial data
  buf.writeDoubleLE(data.timestamp, 1);
  buf.writeInt16LE(Math.round(data.translation.x), 9);
  buf.writeInt16LE(Math.round(data.translation.y), 11);
  buf.writeInt16LE(Math.round(data.translation.z), 13);
  buf.writeInt16LE(Math.round(data.rotation.x), 15);
  buf.writeInt16LE(Math.round(data.rotation.y), 17);
  buf.writeInt16LE(Math.round(data.rotation.z), 19);
  buf.writeUInt32LE(0, 21);
  return buf;
}
