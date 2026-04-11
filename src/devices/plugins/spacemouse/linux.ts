import type { DeviceInfo } from "../../types.js";
import type { PlatformDriver } from "./index.js";

/**
 * Linux driver for 3DConnexion SpaceMouse via libspnav.
 *
 * Uses koffi FFI to load libspnav.so and poll for device events.
 * libspnav provides a simple C API:
 *   - spnav_open() / spnav_close()
 *   - spnav_poll_event(spnav_event *event) — returns event type
 *   - spnav_event is a union of { motion: {x,y,z,rx,ry,rz}, button: {press,bnum} }
 *
 * TODO: Implement after macOS driver is validated.
 */
export class LinuxDriver implements PlatformDriver {
  onSpatialData: PlatformDriver["onSpatialData"] = null;
  onButtonChange: PlatformDriver["onButtonChange"] = null;
  onDeviceAdded: PlatformDriver["onDeviceAdded"] = null;
  onDeviceRemoved: PlatformDriver["onDeviceRemoved"] = null;

  probe(): boolean {
    // TODO: Check for libspnav
    // Typical paths: /usr/lib/libspnav.so, /usr/lib/x86_64-linux-gnu/libspnav.so
    return false;
  }

  async connect(): Promise<void> {
    throw new Error("Linux SpaceMouse driver not yet implemented");
  }

  disconnect(): void {}

  getDevices(): DeviceInfo[] {
    return [];
  }
}
