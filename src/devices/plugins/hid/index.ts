import { DevicePlugin, type DeviceInfo, type SpatialData } from "../../types.js";
import { nativeRequire } from "../../../native-require.js";
import { findMapping, type HIDDeviceMapping } from "./mappings.js";

export { BUILTIN_MAPPINGS, findMapping } from "./mappings.js";
export type { HIDDeviceMapping, AxisMapping, ButtonMapping } from "./mappings.js";

/**
 * Generic HID plugin — supports Space Mushroom, gamepads (Xbox, PlayStation),
 * and other USB HID devices via configurable axis/button mappings.
 *
 * Gamepad axes are normalized to SpaceMouse-equivalent range (-350 to 350).
 * Dead zones filter joystick idle noise. Only emits when input is non-zero.
 */
export class HIDPlugin extends DevicePlugin {
  readonly id = "hid";
  readonly name = "Generic HID / Gamepad";
  readonly supportedPlatforms: NodeJS.Platform[] = ["darwin", "win32", "linux"];

  private customMappings: HIDDeviceMapping[] = [];
  private devices: DeviceInfo[] = [];
  private hidDevice: any = null;

  constructor(customMappings?: HIDDeviceMapping[]) {
    super();
    this.customMappings = customMappings ?? [];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const nodeHid = nativeRequire("node-hid");
      return typeof nodeHid.devices === "function";
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    const HID = nativeRequire("node-hid");

    const hidDevices = HID.devices() as Array<{
      vendorId: number;
      productId: number;
      product?: string;
      path?: string;
    }>;

    for (const dev of hidDevices) {
      const mapping = findMapping(dev.vendorId, dev.productId, this.customMappings);
      // Skip generic fallback (vendorId 0) during auto-enumeration
      if (!mapping || mapping.vendorId === 0) continue;

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

        this.hidDevice.on("data", (report: Buffer) => {
          this.processReport(report, mapping, prevButtons, (buttons) => {
            prevButtons = buttons;
          });
        });

        this.hidDevice.on("error", (err: Error) => {
          this.emit("error", err);
        });

        break;
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
    this.devices = [];
  }

  getDevices(): DeviceInfo[] {
    return [...this.devices];
  }

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
    const offset = mapping.axisOffset ?? 0;

    // Read raw axes based on format
    const rawAxes: number[] = [];
    if (mapping.axisFormat === "uint8") {
      for (let i = 0; i < 8 && offset + i < report.length; i++) {
        rawAxes.push(report[offset + i]);
      }
    } else {
      for (let i = 0; i < 8 && offset + i * 2 + 1 < report.length; i++) {
        rawAxes.push(report.readInt16LE(offset + i * 2));
      }
    }

    const spatial: SpatialData = {
      translation: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      timestamp,
    };

    let hasNonZero = false;

    for (const am of mapping.axes) {
      if (am.sourceAxis >= rawAxes.length) continue;

      // Normalize to -1.0 .. 1.0
      let normalized: number;
      if (mapping.axisFormat === "uint8") {
        normalized = (rawAxes[am.sourceAxis] - 128) / 127;
      } else {
        normalized = rawAxes[am.sourceAxis] / 32767;
      }

      // Dead zone
      const dz = am.deadZone ?? 0;
      if (Math.abs(normalized) < dz) normalized = 0;

      if (am.invert) normalized = -normalized;

      // Scale to SpaceMouse-equivalent range (default 350)
      const value = normalized * (am.scale ?? 350);
      if (value !== 0) hasNonZero = true;

      const [group, axis] = [am.target[0], am.target[1]] as ["t" | "r", "x" | "y" | "z"];
      if (group === "t") spatial.translation[axis] = value;
      else spatial.rotation[axis] = value;
    }

    // Only emit when there's actual input
    if (hasNonZero) {
      this.emit("spatialData", spatial);
    }

    // Buttons
    const btnOffset = mapping.buttonOffset ?? (offset + (mapping.axisFormat === "uint8" ? rawAxes.length : rawAxes.length * 2));
    if (report.length > btnOffset) {
      let buttons = 0;
      for (let i = btnOffset; i < Math.min(report.length, btnOffset + 4); i++) {
        buttons |= report[i] << ((i - btnOffset) * 8);
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
