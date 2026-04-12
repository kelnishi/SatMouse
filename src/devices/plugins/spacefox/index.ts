import { DevicePlugin, type DeviceInfo } from "../../types.js";
import { getConnexionDriver, lookupProduct, buildDeviceInfo, type ConnexionDriver } from "../../drivers/connexion/index.js";

/**
 * 3Dconnexion SpaceFox plugin — compact 6DOF spatial input device.
 * Same 6DOF data as SpaceMouse but in a smaller form factor.
 */
export class SpaceFoxPlugin extends DevicePlugin {
  readonly id = "spacefox";
  readonly name = "3Dconnexion SpaceFox";
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
      if (lookupProduct(event.productId).family !== "spacefox") return;

      if (event.command === 3) {
        this.emit("spatialData", {
          translation: { x: event.axes[0], y: event.axes[1], z: event.axes[2] },
          rotation: { x: event.axes[3], y: event.axes[4], z: event.axes[5] },
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
    });

    this.driver.on("deviceAdded", (productId, deviceId) => {
      if (lookupProduct(productId).family === "spacefox") {
        this.emit("deviceConnected", buildDeviceInfo(productId, deviceId));
      }
    });

    this.driver.on("deviceRemoved", (deviceId) => {
      this.emit("deviceDisconnected", {
        id: deviceId, name: "SpaceFox", model: "SpaceFox", vendor: "3Dconnexion",
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
    return (this.driver?.getDevices() ?? []).filter((d) => lookupProduct(d.productId).family === "spacefox");
  }
}
