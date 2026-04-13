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
  /** Raw bit index in the button bytes */
  sourceButton: number;
  /** Target SatMouse button index */
  targetButton: number;
  /** Human-readable label */
  label?: string;
}

export interface HIDDeviceMapping {
  /** Human-readable name for this mapping profile */
  name: string;
  /** USB vendor ID (0 = match any) */
  vendorId: number;
  /** USB product ID (0 = match any) */
  productId: number;
  /** Device form factor */
  deviceClass?: string;
  /** Axis data format in HID report */
  axisFormat: "int16" | "uint8" | "int12";
  /** Byte offset where axis data starts in the report (default: 0) */
  axisOffset?: number;
  /** Byte offset where button data starts (default: after axes) */
  buttonOffset?: number;
  /** Bitmask to apply to button bytes before comparing (filters d-pad, etc.) */
  buttonMask?: number;
  /** Hat switch (d-pad) configuration. Value 0-7 = direction, 8+ = neutral. */
  hat?: {
    /** Byte offset in the report for the hat value */
    byte: number;
    /** Bitmask to extract the hat value (default: 0x0F for low nibble) */
    mask?: number;
    /** Target button indices for [up, right, down, left] */
    buttons: [number, number, number, number];
    /** Labels for [up, right, down, left] */
    labels?: [string, string, string, string];
  };
  /** Axis mappings */
  axes: AxisMapping[];
  /** Button mappings */
  buttons: ButtonMapping[];
}

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

/** Find the profiles directory — works in dev (tsx), CJS bundle (.app), and SEA */
function findProfilesDir(): string | null {
  const candidates: string[] = [];

  try {
    if (typeof __dirname !== "undefined") {
      candidates.push(join(__dirname, "profiles"));
    }
  } catch {}
  try {
    if (import.meta?.url) {
      const { fileURLToPath } = require("node:url");
      candidates.push(join(dirname(fileURLToPath(import.meta.url)), "profiles"));
    }
  } catch {}

  const execDir = dirname(process.execPath);
  candidates.push(join(execDir, "..", "Resources", "profiles"));
  candidates.push(join(execDir, "profiles"));
  candidates.push(resolve("src/devices/plugins/hid/profiles"));

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Parse a profile JSON, converting hex strings to numbers */
function parseProfile(raw: any): HIDDeviceMapping {
  return {
    ...raw,
    vendorId: typeof raw.vendorId === "string" ? parseInt(raw.vendorId, 16) : raw.vendorId,
    productId: typeof raw.productId === "string" ? parseInt(raw.productId, 16) : raw.productId,
    buttonMask: typeof raw.buttonMask === "string" ? parseInt(raw.buttonMask, 16) : raw.buttonMask,
    axes: (raw.axes ?? []).map((a: any) => ({ ...a, target: a.target as AxisTarget })),
    buttons: raw.buttons ?? [],
  };
}

/** Load all profiles from the profiles/ directory */
function loadProfiles(): HIDDeviceMapping[] {
  try {
    const dir = findProfilesDir();
    if (!dir) throw new Error("profiles/ directory not found");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    const profiles: HIDDeviceMapping[] = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
        profiles.push(parseProfile(raw));
      } catch (err) {
        console.warn(`[HID] Failed to load profile ${file}:`, err);
      }
    }
    console.log(`[HID] Loaded ${profiles.length} device profiles`);
    return profiles;
  } catch (err) {
    console.warn("[HID] Failed to load profiles:", err);
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
