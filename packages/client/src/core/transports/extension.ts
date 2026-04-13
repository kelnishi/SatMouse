import type { Transport } from "./transport.js";
import type { SpatialData, ButtonEvent, DeviceInfo } from "../types.js";

/**
 * Safari Web Extension transport adapter.
 *
 * Communicates with the SatMouse extension via window.postMessage.
 * The extension's content script relays messages to the background
 * service worker, which connects to the native bridge via stdin/stdout.
 *
 * Detection: the content script posts { source: "satmouse-extension", type: "available" }
 * on injection. The adapter listens for this to know the extension is present.
 */
export class ExtensionAdapter implements Transport {
  readonly protocol = "extension" as const;

  onSpatialData: ((data: SpatialData) => void) | null = null;
  onButtonEvent: ((data: ButtonEvent) => void) | null = null;
  onDeviceStatus: ((event: "connected" | "disconnected", device: DeviceInfo) => void) | null = null;
  onClose: (() => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  private messageHandler: ((event: MessageEvent) => void) | null = null;

  /** Check if the extension content script is present */
  static isAvailable(): boolean {
    return !!(globalThis as any).__satmouseExtensionAvailable;
  }

  /** Call early to start listening for the extension's availability signal */
  static listen(): void {
    if (typeof globalThis.addEventListener !== "function") return;
    globalThis.addEventListener("message", (event: MessageEvent) => {
      if (event.data?.source === "satmouse-extension" && event.data?.type === "available") {
        (globalThis as any).__satmouseExtensionAvailable = true;
      }
    });
  }

  async connect(): Promise<void> {
    if (typeof globalThis.postMessage !== "function") {
      throw new Error("postMessage not available");
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.close();
        reject(new Error("Extension connection timeout"));
      }, 3000);

      this.messageHandler = (event: MessageEvent) => {
        if (event.data?.source !== "satmouse-extension") return;
        const msg = event.data;

        if (msg.type === "connected") {
          clearTimeout(timeout);
          resolve();
          return;
        }

        if (msg.type === "disconnected") {
          this.onClose?.();
          return;
        }

        if (msg.type === "error") {
          this.onError?.(new Error(msg.message ?? "Extension error"));
          return;
        }

        if (msg.type === "spatialData" && msg.data) {
          const d = msg.data;
          if (d.translation && d.rotation) {
            this.onSpatialData?.(d as SpatialData);
          }
          return;
        }

        if (msg.type === "buttonEvent" && msg.data) {
          const d = msg.data;
          if (typeof d.button === "number" && typeof d.pressed === "boolean") {
            this.onButtonEvent?.(d as ButtonEvent);
          }
          return;
        }

        if (msg.type === "deviceStatus" && msg.data) {
          this.onDeviceStatus?.(msg.data.event, msg.data.device);
        }
      };

      globalThis.addEventListener("message", this.messageHandler);

      // Request connection from the content script
      globalThis.postMessage({
        target: "satmouse-extension",
        action: "connect"
      }, "*");
    });
  }

  close(): void {
    if (this.messageHandler) {
      globalThis.removeEventListener("message", this.messageHandler);
      this.messageHandler = null;
    }
    globalThis.postMessage({
      target: "satmouse-extension",
      action: "disconnect"
    }, "*");
  }
}

// Start listening for extension availability immediately
ExtensionAdapter.listen();
