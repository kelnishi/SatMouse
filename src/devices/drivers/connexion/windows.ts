import { existsSync } from "node:fs";
import { nativeRequire } from "../../../native-require.js";
import type { DeviceInfo } from "../../types.js";
import { ConnexionDriver } from "./types.js";
import type { ConnexionRawEvent } from "./types.js";
import { buildDeviceInfo } from "./products.js";

// 3DxWare SDK paths — the SDK installs SiApp.dll alongside the driver
const SDK_PATHS = [
  "C:\\Program Files\\3Dconnexion\\3DxWare64\\3DxWinCore64.dll",
  "C:\\Program Files\\3Dconnexion\\3DxWare\\3DxWinCore.dll",
];

/**
 * Windows driver for 3Dconnexion devices via 3DxWare SDK.
 *
 * Uses koffi to load the 3DxWare DLL and poll for device events.
 * The Windows SDK uses SiOpen/SiGetEvent for device communication.
 */
export class WindowsConnexionDriver extends ConnexionDriver {
  private devices: DeviceInfo[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private siHandle: any = null;
  private lib: any = null;

  probe(): boolean {
    return SDK_PATHS.some((p) => existsSync(p));
  }

  async connect(): Promise<void> {
    const koffi: any = nativeRequire("koffi");

    const sdkPath = SDK_PATHS.find((p) => existsSync(p));
    if (!sdkPath) throw new Error("3DxWare SDK not found");

    this.lib = koffi.load(sdkPath);

    // SiInitialize / SiOpen / SiGetEvent / SiClose
    const SiInitialize = this.lib.func("int32_t SiInitialize()");
    const SiOpenPort = this.lib.func("void *SiOpenPort(void *hwnd, int32_t type, void *mask)");
    const SiGetEvent = this.lib.func("int32_t SiGetEvent(void *handle, int32_t flags, void *event, int32_t size)");
    const SiClose = this.lib.func("int32_t SiClose(void *handle)");

    const initResult = SiInitialize();
    if (initResult !== 0) throw new Error(`SiInitialize failed: ${initResult}`);

    // Open with NULL window handle (headless mode)
    this.siHandle = SiOpenPort(null, 0, null);
    if (!this.siHandle) throw new Error("SiOpenPort failed");

    console.log("[3Dconnexion/Windows] Connected");

    // Poll for events
    // SiGetEvent struct: type(4) + data(varies)
    // Motion event: type=1, tx/ty/tz/rx/ry/rz as int32
    // Button event: type=2, pressed/released bitmask
    const EVENT_SIZE = 128;
    let prevButtons = 0;

    this.pollTimer = setInterval(() => {
      const eventBuf = Buffer.alloc(EVENT_SIZE);
      const result = SiGetEvent(this.siHandle, 0, eventBuf, EVENT_SIZE);
      if (result <= 0) return;

      const eventType = eventBuf.readInt32LE(0);

      if (eventType === 1) {
        // Motion event — 6 int32 values at offset 4
        const event: ConnexionRawEvent = {
          command: 3, // kConnexionCmdHandleAxis
          axes: [
            eventBuf.readInt32LE(4),
            eventBuf.readInt32LE(8),
            eventBuf.readInt32LE(12),
            eventBuf.readInt32LE(16),
            eventBuf.readInt32LE(20),
            eventBuf.readInt32LE(24),
          ],
          buttons: prevButtons,
          productId: 0,
        };
        this.emit("rawEvent", event);
      } else if (eventType === 2) {
        // Button event
        const buttons = eventBuf.readUInt32LE(4);
        if (buttons !== prevButtons) {
          const event: ConnexionRawEvent = {
            command: 2, // kConnexionCmdHandleButtons
            axes: [0, 0, 0, 0, 0, 0],
            buttons,
            productId: 0,
          };
          prevButtons = buttons;
          this.emit("rawEvent", event);
        }
      } else if (eventType === 5) {
        // Device change event
        const deviceId = `cnx-win-${Date.now().toString(16)}`;
        const info = buildDeviceInfo(0, deviceId);
        this.devices = [info];
        this.emit("deviceAdded", 0, deviceId);
      }
    }, 4);
  }

  disconnect(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.siHandle && this.lib) {
      try { this.lib.func("int32_t SiClose(void *handle)")(this.siHandle); } catch {}
      this.siHandle = null;
    }
    this.devices = [];
  }

  getDevices(): DeviceInfo[] {
    return [...this.devices];
  }
}
