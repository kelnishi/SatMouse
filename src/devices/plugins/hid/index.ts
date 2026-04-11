import { DevicePlugin, type DeviceInfo, type SpatialData } from "../../types.js";
import { findMapping, type HIDDeviceMapping, type AxisMapping } from "./mappings.js";

export { BUILTIN_MAPPINGS, findMapping } from "./mappings.js";
export type { HIDDeviceMapping, AxisMapping, ButtonMapping } from "./mappings.js";

/**
 * Generic HID plugin — supports Space Mushroom, gamepads (Xbox, PlayStation),
 * and other USB HID devices via configurable axis/button mappings.
 *
 * Uses the Web HID API (browsers) or node-hid (Node.js) depending on environment.
 * Mappings can be customized per vendor/product ID or at runtime.
 */
export class HIDPlugin extends DevicePlugin {
  readonly id = "hid";
  readonly name = "Generic HID / Gamepad";
  readonly supportedPlatforms: NodeJS.Platform[] = ["darwin", "win32", "linux"];

  private customMappings: HIDDeviceMapping[] = [];
  private devices: DeviceInfo[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private hidDevice: any = null;

  constructor(customMappings?: HIDDeviceMapping[]) {
    super();
    this.customMappings = customMappings ?? [];
  }

  async isAvailable(): Promise<boolean> {
    // Check for node-hid availability
    try {
      const nodeHid = await import("node-hid" as any);
      return typeof nodeHid.devices === "function" || typeof nodeHid.default?.devices === "function";
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    const nodeHid = await import("node-hid" as any);
    const HID = nodeHid.default ?? nodeHid;

    // Enumerate HID devices and find ones we have mappings for
    const hidDevices = HID.devices() as Array<{
      vendorId: number;
      productId: number;
      product?: string;
      path?: string;
    }>;

    for (const dev of hidDevices) {
      const mapping = findMapping(dev.vendorId, dev.productId, this.customMappings);
      if (!mapping || mapping.vendorId === 0) continue; // Skip generic fallback during enumeration

      try {
        this.hidDevice = new HID.HID(dev.path ?? `${dev.vendorId}:${dev.productId}`);
        const deviceId = `hid-${dev.vendorId.toString(16)}-${dev.productId.toString(16)}`;
        const info: DeviceInfo = {
          id: deviceId,
          name: mapping.name,
          model: mapping.name,
          vendor: dev.product ?? "HID",
          vendorId: dev.vendorId,
          productId: dev.productId,
          connectionType: "usb",
        };
        this.devices.push(info);
        this.emit("deviceConnected", info);

        console.log(`[HID] Connected: ${mapping.name} (${dev.vendorId.toString(16)}:${dev.productId.toString(16)})`);

        let prevButtons = 0;

        // node-hid delivers data via callback
        this.hidDevice.on("data", (report: Buffer) => {
          this.processReport(report, mapping, prevButtons, (buttons) => {
            prevButtons = buttons;
          });
        });

        this.hidDevice.on("error", (err: Error) => {
          this.emit("error", err);
        });

        break; // Connect first matching device
      } catch (err) {
        console.log(`[HID] Failed to open ${mapping.name}: ${err}`);
      }
    }
  }

  disconnect(): void {
    if (this.hidDevice) {
      try { this.hidDevice.close(); } catch {}
      this.hidDevice = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.devices = [];
  }

  getDevices(): DeviceInfo[] {
    return [...this.devices];
  }

  /** Add a custom mapping at runtime */
  addMapping(mapping: HIDDeviceMapping): void {
    this.customMappings.push(mapping);
  }

  private processReport(
    report: Buffer,
    mapping: HIDDeviceMapping,
    prevButtons: number,
    setButtons: (b: number) => void,
  ): void {
    const timestamp = performance.now() * 1000;

    // Extract axes from the report
    const rawAxes: number[] = [];
    for (let i = 0; i < Math.min(report.length / 2, 8); i++) {
      rawAxes.push(report.readInt16LE(i * 2));
    }

    // Apply axis mappings
    const spatial: SpatialData = {
      translation: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      timestamp,
    };

    for (const am of mapping.axes) {
      if (am.sourceAxis >= rawAxes.length) continue;
      let value = rawAxes[am.sourceAxis];
      if (am.deadZone && Math.abs(value) < am.deadZone * 32767) value = 0;
      if (am.invert) value = -value;
      value *= am.scale ?? 1;

      const [group, axis] = [am.target[0], am.target[1]] as ["t" | "r", "x" | "y" | "z"];
      if (group === "t") spatial.translation[axis] = value;
      else spatial.rotation[axis] = value;
    }

    this.emit("spatialData", spatial);

    // Extract buttons (after axis data in the report)
    const buttonOffset = Math.ceil(rawAxes.length * 2);
    if (report.length > buttonOffset) {
      let buttons = 0;
      for (let i = buttonOffset; i < Math.min(report.length, buttonOffset + 4); i++) {
        buttons |= report[i] << ((i - buttonOffset) * 8);
      }

      if (buttons !== prevButtons) {
        for (const bm of mapping.buttons) {
          const srcMask = 1 << bm.sourceButton;
          if ((buttons & srcMask) !== (prevButtons & srcMask)) {
            this.emit("buttonEvent", {
              button: bm.targetButton,
              pressed: (buttons & srcMask) !== 0,
              timestamp,
            });
          }
        }
        setButtons(buttons);
      }
    }
  }
}
