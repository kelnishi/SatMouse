import { DevicePlugin, type DeviceInfo } from "../../types.js";
import { getConnexionDriver, lookupProduct, buildDeviceInfo, type ConnexionDriver } from "../../drivers/connexion/index.js";

/**
 * 3Dconnexion SpaceMouse plugin — 6DOF spatial input devices.
 * Covers: SpaceNavigator, SpaceMouse Pro, SpaceMouse Wireless,
 * SpaceMouse Compact, SpaceMouse Enterprise, SpacePilot, etc.
 */
export class SpaceMousePlugin extends DevicePlugin {
  readonly id = "spacemouse";
  readonly name = "3Dconnexion SpaceMouse";
  readonly supportedPlatforms: NodeJS.Platform[] = ["darwin", "win32", "linux"];

  private driver: ConnexionDriver | null = null;
  private prevButtons = 0;

  async isAvailable(): Promise<boolean> {
    try {
      this.driver = await getConnexionDriver();
      return this.driver.probe();
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    if (!this.driver) this.driver = await getConnexionDriver();

    this.driver.on("rawEvent", (event) => {
      const product = lookupProduct(event.productId);
      if (product.family !== "spacemouse" && product.family !== "unknown") return;

      if (event.command === 3) {
        this.emit("spatialData", {
          translation: { x: event.axes[0], y: event.axes[1], z: event.axes[2] },
          rotation: { x: event.axes[3], y: event.axes[4], z: event.axes[5] },
          timestamp: performance.now() * 1000,
          deviceId: `cnx-${event.productId.toString(16)}`,
        });
      } else if (event.command === 2 && event.buttons !== this.prevButtons) {
        const timestamp = performance.now() * 1000;
        for (let i = 0; i < 32; i++) {
          const mask = 1 << i;
          if ((event.buttons & mask) !== (this.prevButtons & mask)) {
            this.emit("buttonEvent", { button: i, pressed: (event.buttons & mask) !== 0, timestamp });
          }
        }
        this.prevButtons = event.buttons;
      }
    });

    this.driver.on("deviceAdded", (productId, deviceId) => {
      const product = lookupProduct(productId);
      if (product.family === "spacemouse" || product.family === "unknown") {
        this.emit("deviceConnected", buildDeviceInfo(productId, deviceId));
      }
    });

    this.driver.on("deviceRemoved", (deviceId) => {
      this.emit("deviceDisconnected", {
        id: deviceId, name: "SpaceMouse", model: "SpaceMouse", vendor: "3Dconnexion",
        vendorId: 0x046d, productId: 0, connectionType: "unknown",
      });
    });

    await this.driver.connect();
  }

  disconnect(): void {
    this.driver?.disconnect();
    this.driver = null;
  }

  getDevices(): DeviceInfo[] {
    return (this.driver?.getDevices() ?? []).filter((d) => {
      const product = lookupProduct(d.productId);
      return product.family === "spacemouse" || product.family === "unknown";
    });
  }
}
