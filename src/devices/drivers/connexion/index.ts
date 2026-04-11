import type { ConnexionDriver } from "./types.js";

export type { ConnexionDriver, ConnexionRawEvent, ConnexionCallbacks } from "./types.js";
export { CONNEXION_PRODUCTS, lookupProduct, buildDeviceInfo, CONNEXION_VENDOR_ID } from "./products.js";
export type { ProductInfo, DeviceFamily } from "./products.js";

export async function createConnexionDriver(): Promise<ConnexionDriver> {
  switch (process.platform) {
    case "darwin": {
      const { MacOSConnexionDriver } = await import("./macos.js");
      return new MacOSConnexionDriver();
    }
    case "win32": {
      const { WindowsConnexionDriver } = await import("./windows.js");
      return new WindowsConnexionDriver();
    }
    case "linux": {
      const { LinuxConnexionDriver } = await import("./linux.js");
      return new LinuxConnexionDriver();
    }
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}
