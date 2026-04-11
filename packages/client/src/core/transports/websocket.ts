import type { Transport } from "./transport.js";
import type { SpatialData, ButtonEvent, DeviceInfo } from "../types.js";
import { decodeWsBinaryFrame } from "../decode.js";

export class WebSocketAdapter implements Transport {
  readonly protocol = "websocket" as const;

  onSpatialData: ((data: SpatialData) => void) | null = null;
  onButtonEvent: ((data: ButtonEvent) => void) | null = null;
  onDeviceStatus: ((event: "connected" | "disconnected", device: DeviceInfo) => void) | null = null;
  onClose: (() => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  private ws: WebSocket | null = null;
  private url: string;
  private subprotocol: string;

  constructor(url: string, subprotocol: string = "satmouse-json") {
    this.url = url;
    this.subprotocol = subprotocol;
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.ws = new globalThis.WebSocket(this.url, this.subprotocol);
      if (this.subprotocol === "satmouse-binary") {
        this.ws.binaryType = "arraybuffer";
      }

      this.ws.onopen = () => resolve();

      this.ws.onerror = () => {
        reject(new Error(`WebSocket connection failed: ${this.url}`));
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (this.subprotocol === "satmouse-binary" && event.data instanceof ArrayBuffer) {
          const decoded = decodeWsBinaryFrame(event.data);
          if (decoded?.type === "spatialData") this.onSpatialData?.(decoded.data);
          else if (decoded?.type === "buttonEvent") this.onButtonEvent?.(decoded.data);
        } else if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "spatialData") this.onSpatialData?.(msg.data);
            else if (msg.type === "buttonEvent") this.onButtonEvent?.(msg.data);
            else if (msg.type === "deviceStatus") {
              this.onDeviceStatus?.(msg.data.event, msg.data.device);
            }
          } catch {
            // Ignore malformed messages
          }
        }
      };

      this.ws.onclose = () => this.onClose?.();
    });
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }
}
