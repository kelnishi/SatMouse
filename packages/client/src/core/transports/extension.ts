import type { Transport } from "./transport.js";
import type { SpatialData, ButtonEvent, DeviceInfo } from "../types.js";

/**
 * Safari Web Extension transport adapter.
 *
 * Connects to the SatMouse extension via browser.runtime.connect().
 * The extension relays spatial data from the native bridge via stdin/stdout.
 *
 * This bypasses all HTTPS mixed-content restrictions because the
 * extension communicates with the bridge via native messaging (XPC/IPC),
 * not network requests.
 */
export class ExtensionAdapter implements Transport {
  readonly protocol = "extension" as const;

  onSpatialData: ((data: SpatialData) => void) | null = null;
  onButtonEvent: ((data: ButtonEvent) => void) | null = null;
  onDeviceStatus: ((event: "connected" | "disconnected", device: DeviceInfo) => void) | null = null;
  onClose: (() => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  private port: any = null; // browser.runtime.Port
  private extensionId: string;

  constructor(extensionId: string) {
    this.extensionId = extensionId;
  }

  async connect(): Promise<void> {
    const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
    if (!runtime?.connect) {
      throw new Error("Browser extension API not available");
    }

    return new Promise<void>((resolve, reject) => {
      try {
        this.port = runtime.connect(this.extensionId);
      } catch (err) {
        reject(new Error("Failed to connect to SatMouse extension"));
        return;
      }

      if (!this.port) {
        reject(new Error("SatMouse extension not installed or not enabled"));
        return;
      }

      let connected = false;
      const timeout = setTimeout(() => {
        if (!connected) {
          this.close();
          reject(new Error("Extension connection timeout"));
        }
      }, 5000);

      this.port.onMessage.addListener((msg: any) => {
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "connected" && !connected) {
          connected = true;
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

        // Validate spatial data
        if (msg.type === "spatialData" && msg.data) {
          const d = msg.data;
          if (d.translation && d.rotation &&
              typeof d.translation.x === "number" &&
              typeof d.rotation.x === "number") {
            this.onSpatialData?.(d as SpatialData);
          }
          return;
        }

        // Validate button event
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
      });

      this.port.onDisconnect.addListener(() => {
        if (!connected) {
          clearTimeout(timeout);
          reject(new Error("Extension disconnected during connect"));
        } else {
          this.onClose?.();
        }
      });

      // Subscribe to spatial data stream
      this.port.postMessage({ action: "subscribe" });
    });
  }

  close(): void {
    try { this.port?.disconnect(); } catch {}
    this.port = null;
  }
}
