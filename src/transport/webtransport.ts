import type { SpatialData, ButtonEvent } from "../devices/types.js";
import { isLoopbackAddress, type FocusTracker } from "../focus.js";
import { parseFocusMessage } from "./websocket.js";
import { encodeSpatialBinary } from "./spatial-binary.js";

const MAX_FOCUS_FRAME = 256;

/**
 * WebTransport server for streaming spatial data over HTTP/3 QUIC.
 *
 * - Spatial data: sent as binary datagrams (24 bytes, unreliable/unordered)
 * - Button events: sent on reliable unidirectional streams (JSON)
 * - Focus reports: received on client-opened unidirectional streams, same
 *   length-prefixed JSON framing, accepted from local peers only
 *
 * Requires TLS — uses self-signed certificates for local development.
 */
export class WebTransportServer {
  private server: any = null;
  private sessions = new Set<any>();
  private port: number;
  private certPath: string;
  private keyPath: string;
  private focus: FocusTracker | null = null;

  constructor(port: number, certPath: string, keyPath: string) {
    this.port = port;
    this.certPath = certPath;
    this.keyPath = keyPath;
  }

  /** Set the tracker that receives client focus reports */
  setFocusTracker(focus: FocusTracker): void {
    this.focus = focus;
  }

  async start(): Promise<void> {
    const { readFileSync } = await import("node:fs");
    const { Http3Server } = await import("@fails-components/webtransport");

    const cert = readFileSync(this.certPath);
    const key = readFileSync(this.keyPath);

    this.server = new Http3Server({
      port: this.port,
      host: "0.0.0.0",
      secret: "satmouse",
      cert,
      privKey: key,
    });

    this.server.startServer();

    // Accept incoming WebTransport sessions
    const sessionStream = await this.server.sessionStream("/");
    const sessionReader = sessionStream.getReader();

    this.readSessions(sessionReader);

    console.log(`[WebTransport] Listening on https://0.0.0.0:${this.port}`);
  }

  private async readSessions(reader: any): Promise<void> {
    try {
      while (true) {
        const { value: session, done } = await reader.read();
        if (done) break;

        await session.ready;
        this.sessions.add(session);
        console.log(`[WebTransport] Client connected (${this.sessions.size} total)`);

        if (isLoopbackAddress(session.peerAddress)) this.readFocusStreams(session);

        session.closed
          .then(() => {
            this.sessions.delete(session);
            this.focus?.remove(session);
            console.log(`[WebTransport] Client disconnected (${this.sessions.size} total)`);
          })
          .catch(() => {
            this.sessions.delete(session);
            this.focus?.remove(session);
          });
      }
    } catch (err) {
      console.error("[WebTransport] Session accept error:", err);
    }
  }

  /** Each client-opened stream carries one length-prefixed JSON focus report */
  private async readFocusStreams(session: any): Promise<void> {
    const reader = session.incomingUnidirectionalStreams.getReader();
    try {
      while (true) {
        const { value: stream, done } = await reader.read();
        if (done) break;
        this.readFocusStream(session, stream);
      }
    } catch {
      // Session closed
    }
  }

  private async readFocusStream(session: any, stream: any): Promise<void> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 4 + MAX_FOCUS_FRAME) {
          reader.cancel().catch(() => {});
          return;
        }
        chunks.push(value);
      }
    } catch {
      return;
    }

    const buf = Buffer.concat(chunks);
    if (buf.length < 4) return;
    const payloadLength = buf.readUInt32LE(0);
    if (payloadLength !== buf.length - 4) return;
    const focused = parseFocusMessage(buf.subarray(4).toString("utf-8"));
    if (focused !== null && this.sessions.has(session)) this.focus?.set(session, focused);
  }

  broadcastSpatialData(data: SpatialData): void {
    const buf = encodeSpatialBinary(data);
    for (const session of this.sessions) {
      try {
        const writer = session.datagrams.writable.getWriter();
        writer.write(buf);
        writer.releaseLock();
      } catch {
        // Session may have closed — will be cleaned up by the closed handler
      }
    }
  }

  broadcastButtonEvent(data: ButtonEvent): void {
    const json = JSON.stringify(data);
    const payload = Buffer.from(json, "utf-8");
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32LE(payload.length, 0);
    const frame = Buffer.concat([lenBuf, payload]);

    for (const session of this.sessions) {
      try {
        const stream = session.createUnidirectionalStream();
        stream.then((s: any) => {
          const writer = s.getWriter();
          writer.write(frame);
          writer.close();
        });
      } catch {
        // Ignore
      }
    }
  }

  stop(): void {
    for (const session of this.sessions) {
      this.focus?.remove(session);
      try {
        session.close();
      } catch {}
    }
    this.sessions.clear();
    this.server?.stopServer();
    console.log("[WebTransport] Stopped");
  }
}
