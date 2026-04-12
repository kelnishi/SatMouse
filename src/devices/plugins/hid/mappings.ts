/**
 * Gamepad/HID axis mapping configuration.
 *
 * Maps raw HID axes and buttons to SatMouse 6DOF spatial data.
 * Each mapping defines which raw axis index maps to which spatial axis,
 * with optional scale, dead zone, and inversion.
 */

export interface AxisMapping {
  /** Byte offset in the HID report for this axis */
  sourceAxis: number;
  /** Target spatial axis */
  target: "tx" | "ty" | "tz" | "rx" | "ry" | "rz";
  /** Scale multiplier applied after normalization (default: 350 = SpaceMouse range) */
  scale?: number;
  /** Invert the axis (default: false) */
  invert?: boolean;
  /** Dead zone as fraction of full range, 0-1 (default: 0) */
  deadZone?: number;
}

export interface ButtonMapping {
  /** Raw button index from the HID report */
  sourceButton: number;
  /** Target SatMouse button index */
  targetButton: number;
}

export interface HIDDeviceMapping {
  /** Human-readable name for this mapping profile */
  name: string;
  /** USB vendor ID (0 = match any) */
  vendorId: number;
  /** USB product ID (0 = match any) */
  productId: number;
  /** Axis data format in HID report */
  axisFormat: "int16" | "uint8";
  /** Byte offset where axis data starts in the report (default: 0) */
  axisOffset?: number;
  /** Byte offset where button data starts (default: after axes) */
  buttonOffset?: number;
  /** Axis mappings */
  axes: AxisMapping[];
  /** Button mappings */
  buttons: ButtonMapping[];
}

/** Built-in mapping profiles for known devices */
export const BUILTIN_MAPPINGS: HIDDeviceMapping[] = [
  // Space Mushroom (Ahmsville Labs) — DIY 6DOF
  {
    name: "Space Mushroom",
    vendorId: 0x1209,
    productId: 0x0001,
    axisFormat: "int16",
    axes: [
      { sourceAxis: 0, target: "tx" },
      { sourceAxis: 1, target: "ty" },
      { sourceAxis: 2, target: "tz" },
      { sourceAxis: 3, target: "rx" },
      { sourceAxis: 4, target: "ry" },
      { sourceAxis: 5, target: "rz" },
    ],
    buttons: [
      { sourceButton: 0, targetButton: 0 },
      { sourceButton: 1, targetButton: 1 },
    ],
  },

  // Xbox Controller — dual stick mapped to 6DOF
  {
    name: "Xbox Controller",
    vendorId: 0x045e,
    productId: 0x0000,
    axisFormat: "uint8",
    axisOffset: 1, // First byte is report ID
    axes: [
      { sourceAxis: 0, target: "tx", deadZone: 0.15 },
      { sourceAxis: 1, target: "tz", invert: true, deadZone: 0.15 },
      { sourceAxis: 3, target: "ry", deadZone: 0.15 },
      { sourceAxis: 4, target: "rx", invert: true, deadZone: 0.15 },
    ],
    buttons: [
      { sourceButton: 0, targetButton: 0 },
      { sourceButton: 1, targetButton: 1 },
      { sourceButton: 2, targetButton: 2 },
      { sourceButton: 3, targetButton: 3 },
    ],
  },

  // PlayStation DualShock/DualSense — dual stick mapped to 6DOF
  {
    name: "PlayStation Controller",
    vendorId: 0x054c,
    productId: 0x0000,
    axisFormat: "uint8",
    axisOffset: 1, // First byte is report ID
    axes: [
      { sourceAxis: 0, target: "tx", deadZone: 0.15 },
      { sourceAxis: 1, target: "tz", invert: true, deadZone: 0.15 },
      { sourceAxis: 2, target: "ry", deadZone: 0.15 },
      { sourceAxis: 3, target: "rx", invert: true, deadZone: 0.15 },
    ],
    buttons: [
      { sourceButton: 0, targetButton: 0 },
      { sourceButton: 1, targetButton: 1 },
      { sourceButton: 2, targetButton: 2 },
      { sourceButton: 3, targetButton: 3 },
    ],
  },

  // Generic 6DOF HID — fallback for any unrecognized 6-axis device
  {
    name: "Generic 6DOF HID",
    vendorId: 0,
    productId: 0,
    axisFormat: "int16",
    axes: [
      { sourceAxis: 0, target: "tx" },
      { sourceAxis: 1, target: "ty" },
      { sourceAxis: 2, target: "tz" },
      { sourceAxis: 3, target: "rx" },
      { sourceAxis: 4, target: "ry" },
      { sourceAxis: 5, target: "rz" },
    ],
    buttons: [],
  },
];

/** Find the best matching mapping for a device by vendor/product ID */
export function findMapping(vendorId: number, productId: number, custom?: HIDDeviceMapping[]): HIDDeviceMapping | null {
  const all = [...(custom ?? []), ...BUILTIN_MAPPINGS];

  // Exact match (both vendor and product)
  const exact = all.find((m) => m.vendorId === vendorId && m.productId === productId);
  if (exact) return exact;

  // Vendor match (product = 0 wildcard)
  const vendor = all.find((m) => m.vendorId === vendorId && m.productId === 0);
  if (vendor) return vendor;

  // Generic fallback (both = 0)
  return all.find((m) => m.vendorId === 0 && m.productId === 0) ?? null;
}
