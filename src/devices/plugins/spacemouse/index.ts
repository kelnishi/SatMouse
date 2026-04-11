import { DevicePlugin, type DeviceInfo } from "../../types.js";

/**
 * 3DConnexion SpaceMouse device plugin.
 *
 * Delegates to the appropriate platform-specific driver based on
 * process.platform. Each driver uses koffi FFI to call the native
 * 3DConnexion SDK:
 *   - macOS:   3DconnexionClient.framework
 *   - Windows: 3DxWare64.dll
 *   - Linux:   libspnav.so
 */
export class SpaceMousePlugin extends DevicePlugin {
  readonly id = "spacemouse";
  readonly name = "3DConnexion SpaceMouse";
  readonly supportedPlatforms: NodeJS.Platform[] = ["darwin", "win32", "linux"];

  private driver: PlatformDriver | null = null;

  async isAvailable(): Promise<boolean> {
    try {
      const driver = await this.loadDriver();
      const available = driver.probe();
      return available;
    } catch (err) {
      console.log(`[SpaceMouse] isAvailable check failed:`, err);
      return false;
    }
  }

  async connect(): Promise<void> {
    this.driver = await this.loadDriver();
    this.driver.onSpatialData = (tx, ty, tz, rx, ry, rz) => {
      this.emit("spatialData", {
        translation: { x: tx, y: ty, z: tz },
        rotation: { x: rx, y: ry, z: rz },
        timestamp: performance.now() * 1000,
      });
    };
    this.driver.onButtonChange = (buttons, prevButtons) => {
      const timestamp = performance.now() * 1000;
      for (let i = 0; i < 32; i++) {
        const mask = 1 << i;
        const now = buttons & mask;
        const prev = prevButtons & mask;
        if (now !== prev) {
          this.emit("buttonEvent", {
            button: i,
            pressed: now !== 0,
            timestamp,
          });
        }
      }
    };
    this.driver.onDeviceAdded = (id: string) => {
      this.emit("deviceConnected", {
        id,
        name: "SpaceMouse",
        vendorId: 0x046d,
        productId: 0,
      });
    };
    this.driver.onDeviceRemoved = (id: string) => {
      this.emit("deviceDisconnected", {
        id,
        name: "SpaceMouse",
        vendorId: 0x046d,
        productId: 0,
      });
    };
    await this.driver.connect();
  }

  disconnect(): void {
    this.driver?.disconnect();
    this.driver = null;
  }

  getDevices(): DeviceInfo[] {
    return this.driver?.getDevices() ?? [];
  }

  private async loadDriver(): Promise<PlatformDriver> {
    switch (process.platform) {
      case "darwin": {
        const { MacOSDriver } = await import("./macos.js");
        return new MacOSDriver();
      }
      case "win32": {
        const { WindowsDriver } = await import("./windows.js");
        return new WindowsDriver();
      }
      case "linux": {
        const { LinuxDriver } = await import("./linux.js");
        return new LinuxDriver();
      }
      default:
        throw new Error(`Unsupported platform: ${process.platform}`);
    }
  }
}

/** Interface that each platform driver must implement */
export interface PlatformDriver {
  onSpatialData: ((tx: number, ty: number, tz: number, rx: number, ry: number, rz: number) => void) | null;
  onButtonChange: ((buttons: number, prevButtons: number) => void) | null;
  onDeviceAdded: ((id: string) => void) | null;
  onDeviceRemoved: ((id: string) => void) | null;

  /** Check if the native SDK/library is loadable */
  probe(): boolean;

  /** Start receiving device events */
  connect(): Promise<void>;

  /** Stop and release resources */
  disconnect(): void;

  /** List connected devices */
  getDevices(): DeviceInfo[];
}
