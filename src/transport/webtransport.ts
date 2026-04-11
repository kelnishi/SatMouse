import type { SpatialData, ButtonEvent } from "../devices/types.js";

/**
 * WebTransport server for streaming spatial data over HTTP/3 QUIC.
 *
 * - Spatial data: sent as binary datagrams (24 bytes, unreliable/unordered)
 * - Button events: sent on reliable unidirectional streams (JSON)
 *
 * Requires TLS — uses self-signed certificates for local development.
 */
export class WebTransportServer {
  private server: any = null;
  private sessions = new Set<any>();
  private port: number;
  private certPath: string;
  private keyPath: string;

  constructor(port: number, certPath: string, keyPath: string) {
    this.port = port;
    this.certPath = certPath;
    this.keyPath = keyPath;
  }

  async start(): Promise<void> {
    const { readFileSync } = await import("node:fs");
    const { Http3Server } = await import("@anthropic-ai/sdk" as any).catch(
      () => import("@fails-components/webtransport")
    );

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

        session.closed
          .then(() => {
            this.sessions.delete(session);
            console.log(`[WebTransport] Client disconnected (${this.sessions.size} total)`);
          })
          .catch(() => {
            this.sessions.delete(session);
          });
      }
    } catch (err) {
      console.error("[WebTransport] Session accept error:", err);
    }
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
      try {
        session.close();
      } catch {}
    }
    this.sessions.clear();
    this.server?.stopServer();
    console.log("[WebTransport] Stopped");
  }
}

/** Encode SpatialData to 24-byte binary buffer (see docs/protocol.md) */
function encodeSpatialBinary(data: SpatialData): Uint8Array {
  const buf = Buffer.allocUnsafe(24);
  buf.writeDoubleLE(data.timestamp, 0);
  buf.writeInt16LE(Math.round(data.translation.x), 8);
  buf.writeInt16LE(Math.round(data.translation.y), 10);
  buf.writeInt16LE(Math.round(data.translation.z), 12);
  buf.writeInt16LE(Math.round(data.rotation.x), 14);
  buf.writeInt16LE(Math.round(data.rotation.y), 16);
  buf.writeInt16LE(Math.round(data.rotation.z), 18);
  buf.writeUInt32LE(0, 20); // buttons not included in SpatialData; sent separately
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
