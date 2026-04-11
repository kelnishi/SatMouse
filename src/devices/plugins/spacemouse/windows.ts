import type { DeviceInfo } from "../../types.js";
import type { PlatformDriver } from "./index.js";

/**
 * Windows driver for 3DConnexion SpaceMouse via 3DxWare SDK.
 *
 * Uses koffi FFI to load the 3DxWare DLL (SiApp.dll) and poll for
 * device events. The Windows SDK uses a polling model with SiGetEvent().
 *
 * TODO: Implement after macOS driver is validated.
 */
export class WindowsDriver implements PlatformDriver {
  onSpatialData: PlatformDriver["onSpatialData"] = null;
  onButtonChange: PlatformDriver["onButtonChange"] = null;
  onDeviceAdded: PlatformDriver["onDeviceAdded"] = null;
  onDeviceRemoved: PlatformDriver["onDeviceRemoved"] = null;

  probe(): boolean {
    // TODO: Check for 3DxWare installation
    // Typical paths:
    //   C:\Program Files\3Dconnexion\3DxWare64\3DxWinCore64.dll
    //   Or via registry: HKLM\SOFTWARE\3Dconnexion
    return false;
  }

  async connect(): Promise<void> {
    throw new Error("Windows SpaceMouse driver not yet implemented");
  }

  disconnect(): void {}

  getDevices(): DeviceInfo[] {
    return [];
  }
}
