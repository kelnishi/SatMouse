/**
 * Gamepad/HID axis mapping configuration.
 *
 * Maps raw HID axes and buttons to SatMouse 6DOF spatial data.
 * Each mapping defines which raw axis index maps to which spatial axis,
 * with optional scale, dead zone, and inversion.
 */

export interface AxisMapping {
  /** Raw axis index from the HID report */
  sourceAxis: number;
  /** Target spatial axis */
  target: "tx" | "ty" | "tz" | "rx" | "ry" | "rz";
  /** Scale multiplier (default: 1) */
  scale?: number;
  /** Invert the axis (default: false) */
  invert?: boolean;
  /** Dead zone threshold (default: 0) */
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
    vendorId: 0x1209, // pid.codes VID
    productId: 0x0001,
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
    vendorId: 0x045e, // Microsoft
    productId: 0x0000, // 0 = match any Microsoft gamepad
    axes: [
      { sourceAxis: 0, target: "tx", deadZone: 0.1 },        // Left stick X → TX
      { sourceAxis: 1, target: "tz", invert: true, deadZone: 0.1 }, // Left stick Y → TZ
      { sourceAxis: 2, target: "ty", deadZone: 0.1 },        // Left trigger → TY (forward)
      { sourceAxis: 3, target: "rx", deadZone: 0.1 },        // Right stick X → RX (unassigned, available)
      { sourceAxis: 4, target: "ry", deadZone: 0.1 },        // Right stick Y → RY
      { sourceAxis: 5, target: "rz", deadZone: 0.1 },        // Right trigger → RZ (roll, optional)
    ],
    buttons: [
      { sourceButton: 0, targetButton: 0 },  // A
      { sourceButton: 1, targetButton: 1 },  // B
      { sourceButton: 2, targetButton: 2 },  // X
      { sourceButton: 3, targetButton: 3 },  // Y
      { sourceButton: 4, targetButton: 4 },  // LB
      { sourceButton: 5, targetButton: 5 },  // RB
    ],
  },

  // PlayStation DualSense/DualShock — dual stick mapped to 6DOF
  {
    name: "PlayStation Controller",
    vendorId: 0x054c, // Sony
    productId: 0x0000, // 0 = match any Sony gamepad
    axes: [
      { sourceAxis: 0, target: "tx", deadZone: 0.1 },
      { sourceAxis: 1, target: "tz", invert: true, deadZone: 0.1 },
      { sourceAxis: 2, target: "ty", deadZone: 0.1 },
      { sourceAxis: 3, target: "rx", deadZone: 0.1 },
      { sourceAxis: 4, target: "ry", deadZone: 0.1 },
      { sourceAxis: 5, target: "rz", deadZone: 0.1 },
    ],
    buttons: [
      { sourceButton: 0, targetButton: 0 },  // Cross
      { sourceButton: 1, targetButton: 1 },  // Circle
      { sourceButton: 2, targetButton: 2 },  // Square
      { sourceButton: 3, targetButton: 3 },  // Triangle
      { sourceButton: 4, targetButton: 4 },  // L1
      { sourceButton: 5, targetButton: 5 },  // R1
    ],
  },

  // Generic 6DOF HID — fallback for any unrecognized 6-axis device
  {
    name: "Generic 6DOF HID",
    vendorId: 0,
    productId: 0,
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
