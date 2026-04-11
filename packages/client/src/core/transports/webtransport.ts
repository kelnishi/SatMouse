import type { Transport } from "./transport.js";
import type { SpatialData, ButtonEvent } from "../types.js";
import { decodeBinaryFrame, decodeButtonStream } from "../decode.js";

export class WebTransportAdapter implements Transport {
  readonly protocol = "webtransport" as const;

  onSpatialData: ((data: SpatialData) => void) | null = null;
  onButtonEvent: ((data: ButtonEvent) => void) | null = null;
  onClose: (() => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  private transport: any = null;
  private url: string;
  private certHash?: string;

  constructor(url: string, certHash?: string) {
    this.url = url;
    this.certHash = certHash;
  }

  async connect(): Promise<void> {
    if (typeof globalThis.WebTransport === "undefined") {
      throw new Error("WebTransport is not available in this environment");
    }

    const options: any = {};
    if (this.certHash) {
      options.serverCertificateHashes = [
        {
          algorithm: "sha-256",
          value: Uint8Array.from(atob(this.certHash), (c) => c.charCodeAt(0)),
        },
      ];
    }

    this.transport = new (globalThis as any).WebTransport(this.url, options);
    await this.transport.ready;

    this.readDatagrams();
    this.readStreams();

    this.transport.closed
      .then(() => this.onClose?.())
      .catch(() => this.onClose?.());
  }

  close(): void {
    try {
      this.transport?.close();
    } catch {}
    this.transport = null;
  }

  private async readDatagrams(): Promise<void> {
    const reader = this.transport.datagrams.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        this.onSpatialData?.(decodeBinaryFrame(value));
      }
    } catch {
      // Transport closed
    }
  }

  private async readStreams(): Promise<void> {
    const reader = this.transport.incomingUnidirectionalStreams.getReader();
    try {
      while (true) {
        const { value: stream, done } = await reader.read();
        if (done) break;
        this.readButtonStream(stream);
      }
    } catch {
      // Transport closed
    }
  }

  private async readButtonStream(stream: any): Promise<void> {
    const reader = stream.getReader();
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const newBuf = new Uint8Array(buffer.length + value.length);
        newBuf.set(buffer);
        newBuf.set(value, buffer.length);

        const { events, remainder } = decodeButtonStream(newBuf);
        for (const event of events) {
          this.onButtonEvent?.(event);
        }
        buffer = remainder;
      }
    } catch {
      // Stream closed
    }
  }
}
