import { DevicePlugin, type DeviceInfo } from "../../types.js";
import { createConnexionDriver, lookupProduct, buildDeviceInfo, type ConnexionDriver } from "../../drivers/connexion/index.js";

/**
 * 3Dconnexion Orbion plugin — rotary dial with haptic feedback.
 * Single rotation axis + button. Maps dial rotation to RZ axis.
 */
export class OrbionPlugin extends DevicePlugin {
  readonly id = "orbion";
  readonly name = "3Dconnexion Orbion";
  readonly supportedPlatforms: NodeJS.Platform[] = ["darwin", "win32", "linux"];

  private driver: ConnexionDriver | null = null;
  private prevButtons = 0;

  async isAvailable(): Promise<boolean> {
    try {
      this.driver = await createConnexionDriver();
      return this.driver.probe();
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    if (!this.driver) this.driver = await createConnexionDriver();

    this.driver.onRawEvent = (event) => {
      const product = lookupProduct(event.productId);
      if (product.family !== "orbion") return;

      if (event.command === 3) {
        // Orbion sends rotation on a single axis — map to RZ
        this.emit("spatialData", {
          translation: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: event.axes[5] },
          timestamp: performance.now() * 1000,
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
    };

    this.driver.onDeviceAdded = (productId, deviceId) => {
      if (lookupProduct(productId).family === "orbion") {
        this.emit("deviceConnected", buildDeviceInfo(productId, deviceId));
      }
    };

    this.driver.onDeviceRemoved = (deviceId) => {
      this.emit("deviceDisconnected", {
        id: deviceId, name: "Orbion", model: "Orbion", vendor: "3Dconnexion",
        vendorId: 0x046d, productId: 0, connectionType: "unknown",
      });
    };

    await this.driver.connect();
  }

  disconnect(): void {
    this.driver?.disconnect();
    this.driver = null;
  }

  getDevices(): DeviceInfo[] {
    return (this.driver?.getDevices() ?? []).filter((d) => lookupProduct(d.productId).family === "orbion");
  }
}
