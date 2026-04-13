import type { Transport } from "./transport.js";
import type { SpatialData, ButtonEvent, DeviceInfo } from "../types.js";

/**
 * Safari Web Extension transport adapter.
 *
 * The SatMouse extension's content script sets window.__satmouseExtensionAvailable
 * and bridges postMessage ↔ background script ↔ WebSocket to the bridge.
 *
 * This transport is transparent to the SDK — it just works when the extension
 * is installed, bypassing Safari's mixed-content restrictions entirely.
 */
export class ExtensionAdapter implements Transport {
  readonly protocol = "extension" as const;

  onSpatialData: ((data: SpatialData) => void) | null = null;
  onButtonEvent: ((data: ButtonEvent) => void) | null = null;
  onDeviceStatus: ((event: "connected" | "disconnected", device: DeviceInfo) => void) | null = null;
  onClose: (() => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  private messageHandler: ((event: MessageEvent) => void) | null = null;

  static isAvailable(): boolean {
    return !!(globalThis as any).__satmouseExtensionAvailable;
  }

  async connect(): Promise<void> {
    if (typeof globalThis.postMessage !== "function") {
      throw new Error("postMessage not available");
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.close();
        reject(new Error("Extension connection timeout"));
      }, 5000);

      this.messageHandler = (event: MessageEvent) => {
        if (event.data?.source !== "satmouse-extension") return;
        const msg = event.data;

        if ((msg.type === "connected" || msg.type === "bridgeConnected") && timeout) {
          clearTimeout(timeout);
          resolve();
        }

        if (msg.type === "disconnected") {
          this.onClose?.();
        }

        if (msg.type === "spatialData" && msg.data) {
          this.onSpatialData?.(msg.data as SpatialData);
        }

        if (msg.type === "buttonEvent" && msg.data) {
          this.onButtonEvent?.(msg.data as ButtonEvent);
        }

        if (msg.type === "deviceStatus" && msg.data) {
          this.onDeviceStatus?.(msg.data.event, msg.data.device);
        }
      };

      globalThis.addEventListener("message", this.messageHandler);
      globalThis.postMessage({ target: "satmouse-extension", action: "connect" }, "*");
    });
  }

  close(): void {
    if (this.messageHandler) {
      globalThis.removeEventListener("message", this.messageHandler);
      this.messageHandler = null;
    }
    globalThis.postMessage({ target: "satmouse-extension", action: "disconnect" }, "*");
  }
}
