import { DevicePlugin, type DeviceInfo } from "../../types.js";
import { getConnexionDriver, lookupProduct, buildDeviceInfo, type ConnexionDriver } from "../../drivers/connexion/index.js";

/**
 * 3Dconnexion CadMouse plugin — precision mouse with programmable buttons.
 * No spatial axes — button events only.
 */
export class CadMousePlugin extends DevicePlugin {
  readonly id = "cadmouse";
  readonly name = "3Dconnexion CadMouse";
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
      if (product.family !== "cadmouse") return;

      if (event.command === 2 && event.buttons !== this.prevButtons) {
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
      if (lookupProduct(productId).family === "cadmouse") {
        this.emit("deviceConnected", buildDeviceInfo(productId, deviceId));
      }
    });

    this.driver.on("deviceRemoved", (deviceId) => {
      this.emit("deviceDisconnected", {
        id: deviceId, name: "CadMouse", model: "CadMouse", vendor: "3Dconnexion",
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
    return (this.driver?.getDevices() ?? []).filter((d) => lookupProduct(d.productId).family === "cadmouse");
  }
}
