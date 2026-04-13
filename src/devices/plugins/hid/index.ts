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
  override readonly supportsRescan = true;

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
          axes: mapping.axes.map((a) => a.target),
          axisLabels: mapping.axes.map((a) => a.label ?? a.target.toUpperCase()),
          buttonCount: mapping.buttons.length,
          buttonLabels: mapping.buttons.map((b) => b.label ?? `Button ${b.targetButton}`),
        };
        this.devices.push(info);
        this.emit("deviceConnected", info);

        console.log(`[HID] Connected: ${mapping.name} (${dev.vendorId.toString(16)}:${dev.productId.toString(16)})`);

        let prevButtons = 0;

        this.hidDevice.on("data", (report: Buffer) => {
          this.processReport(report, mapping, deviceId, prevButtons, (buttons) => {
            prevButtons = buttons;
          });
        });

        this.hidDevice.on("error", (err: Error) => {
          console.log(`[HID] Device error (${mapping.name}): ${err.message}`);
          try { this.hidDevice?.close(); } catch {}
          this.hidDevice = null;
          const idx = this.devices.findIndex((d) => d.id === deviceId);
          if (idx !== -1) {
            const removed = this.devices.splice(idx, 1)[0];
            this.emit("deviceDisconnected", removed);
          }
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
    deviceId: string,
    prevButtons: number,
    setButtons: (b: number) => void,
  ): void {
    const timestamp = performance.now() * 1000;
    const offset = mapping.axisOffset ?? 0;

    // Read enough raw bytes to cover the highest sourceAxis in the mapping
    const maxAxis = mapping.axes.reduce((m, a) => Math.max(m, a.sourceAxis), 0);
    const axisCount = maxAxis + 1;
    const rawAxes: number[] = [];
    if (mapping.axisFormat === "uint8") {
      for (let i = 0; i < axisCount && offset + i < report.length; i++) {
        rawAxes.push(report[offset + i]);
      }
    } else if (mapping.axisFormat === "int12") {
      // 12-bit packed pairs: [lo0, hi0_lo1, hi1, lo2, hi2_lo3, hi3, ...]
      // Each pair of axes occupies 3 bytes
      for (let i = 0; i < axisCount; i++) {
        const byteOff = offset + Math.floor(i / 2) * 3;
        if (byteOff + 2 >= report.length) break;
        if (i % 2 === 0) {
          rawAxes.push(report[byteOff] | ((report[byteOff + 1] & 0x0F) << 8));
        } else {
          rawAxes.push((report[byteOff + 1] >> 4) | (report[byteOff + 2] << 4));
        }
      }
    } else {
      for (let i = 0; i < axisCount && offset + i * 2 + 1 < report.length; i++) {
        rawAxes.push(report.readInt16LE(offset + i * 2));
      }
    }

    const spatial: SpatialData = {
      translation: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      timestamp,
      deviceId,
    };

    let hasNonZero = false;

    for (const am of mapping.axes) {
      if (am.sourceAxis >= rawAxes.length) continue;

      // Parse target: "tx", "tz+", "tz-"
      const isHalfPos = am.target.endsWith("+");
      const isHalfNeg = am.target.endsWith("-");
      const isHalf = isHalfPos || isHalfNeg;
      const isUnipolar = am.unipolar ?? isHalf;

      // Normalize to -1.0 .. 1.0 (bipolar) or 0.0 .. 1.0 (unipolar)
      let normalized: number;
      if (isUnipolar) {
        const max = mapping.axisFormat === "uint8" ? 255 : mapping.axisFormat === "int12" ? 4095 : 32767;
        normalized = rawAxes[am.sourceAxis] / max;
      } else if (mapping.axisFormat === "uint8") {
        normalized = (rawAxes[am.sourceAxis] - 128) / 127;
      } else if (mapping.axisFormat === "int12") {
        normalized = (rawAxes[am.sourceAxis] - 2048) / 2047;
      } else {
        normalized = rawAxes[am.sourceAxis] / 32767;
      }

      // Dead zone
      const dz = am.deadZone ?? 0;
      if (Math.abs(normalized) < dz) normalized = 0;

      if (am.invert) normalized = -normalized;

      // Half-axis: positive half contributes positive, negative half contributes negative
      if (isHalfNeg) normalized = -normalized;

      // Scale to SpaceMouse-equivalent range (default 350)
      const value = normalized * (am.scale ?? 350);
      if (value !== 0) hasNonZero = true;

      const baseTarget = am.target.replace(/[+-]$/, "");
      const [group, axis] = [baseTarget[0], baseTarget[1]] as ["t" | "r", "x" | "y" | "z"];
      if (group === "t") spatial.translation[axis] += value;
      else spatial.rotation[axis] += value;
    }

    // Only emit when there's actual input
    if (hasNonZero) {
      this.emit("spatialData", spatial);
    }

    // Buttons
    const btnOffset = mapping.buttonOffset ?? (offset + (mapping.axisFormat === "uint8" ? rawAxes.length : rawAxes.length * 2));
    const maxBtn = mapping.buttons.reduce((m, b) => Math.max(m, b.sourceButton), -1);
    const btnBytes = maxBtn >= 0 ? Math.ceil((maxBtn + 1) / 8) : 0;
    const btnMask = mapping.buttonMask ?? 0xFFFFFFFF;
    if (btnBytes > 0 && report.length > btnOffset) {
      let buttons = 0;
      for (let i = btnOffset; i < Math.min(report.length, btnOffset + btnBytes); i++) {
        buttons |= report[i] << ((i - btnOffset) * 8);
      }
      buttons &= btnMask; // Filter out d-pad or other non-button bits
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
