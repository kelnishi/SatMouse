import type { ConnexionDriver } from "./types.js";

export { ConnexionDriver } from "./types.js";
export type { ConnexionRawEvent } from "./types.js";
export { CONNEXION_PRODUCTS, lookupProduct, buildDeviceInfo, CONNEXION_VENDOR_ID } from "./products.js";
export type { ProductInfo, DeviceFamily } from "./products.js";

/** Singleton — all 3Dconnexion plugins share one driver instance */
let sharedDriver: ConnexionDriver | undefined;

export async function getConnexionDriver(): Promise<ConnexionDriver> {
  if (sharedDriver) return sharedDriver;

  switch (process.platform) {
    case "darwin": {
      const { MacOSConnexionDriver } = await import("./macos.js");
      sharedDriver = new MacOSConnexionDriver();
      break;
    }
    case "win32": {
      const { WindowsConnexionDriver } = await import("./windows.js");
      sharedDriver = new WindowsConnexionDriver();
      break;
    }
    case "linux": {
      const { LinuxConnexionDriver } = await import("./linux.js");
      sharedDriver = new LinuxConnexionDriver();
      break;
    }
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }

  return sharedDriver;
}
