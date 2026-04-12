/**
 * Gamepad/HID axis mapping configuration.
 *
 * Maps raw HID axes and buttons to SatMouse 6DOF spatial data.
 * Each mapping defines which raw axis index maps to which spatial axis,
 * with optional scale, dead zone, and inversion.
 */

/** Full axis ("tx") or half axis ("tx+", "tx-") target */
export type AxisTarget =
  | "tx" | "ty" | "tz" | "rx" | "ry" | "rz"
  | "tx+" | "ty+" | "tz+" | "rx+" | "ry+" | "rz+"
  | "tx-" | "ty-" | "tz-" | "rx-" | "ry-" | "rz-";

export interface AxisMapping {
  /** Byte offset in the HID report for this axis */
  sourceAxis: number;
  /** Target spatial axis. Half-axis targets ("tz+", "tz-") map a unipolar input to the
   *  positive or negative side of the axis. Two inputs can share the same axis (e.g.,
   *  L2 → "tz+" and R2 → "tz-" combine into a single TZ that rests at zero). */
  target: AxisTarget;
  /** Human-readable label for this axis (e.g., "Left Stick X", "R2 Trigger") */
  label?: string;
  /** Scale multiplier applied after normalization (default: 350 = SpaceMouse range) */
  scale?: number;
  /** Invert the axis (default: false) */
  invert?: boolean;
  /** Dead zone as fraction of full range, 0-1 (default: 0) */
  deadZone?: number;
  /** Unipolar axis (0..max) like analog triggers, instead of bipolar (-max..max) like joysticks.
   *  Automatically set to true for half-axis targets ("tz+", "tz-"). */
  unipolar?: boolean;
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

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Load profiles from profiles.json, converting hex vendorId/productId strings to numbers */
function loadProfiles(): HIDDeviceMapping[] {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const raw = JSON.parse(readFileSync(join(dir, "profiles.json"), "utf-8"));
    return (raw.profiles as any[]).map((p) => ({
      ...p,
      vendorId: typeof p.vendorId === "string" ? parseInt(p.vendorId, 16) : p.vendorId,
      productId: typeof p.productId === "string" ? parseInt(p.productId, 16) : p.productId,
      axes: p.axes.map((a: any) => ({ ...a, target: a.target as AxisTarget })),
    }));
  } catch (err) {
    console.warn("[HID] Failed to load profiles.json:", err);
    return [];
  }
}

/** Generic fallback for unrecognized 6-axis devices */
const GENERIC_FALLBACK: HIDDeviceMapping = {
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
};

/** Built-in profiles loaded from profiles.json + generic fallback */
export const BUILTIN_MAPPINGS: HIDDeviceMapping[] = [...loadProfiles(), GENERIC_FALLBACK];

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
