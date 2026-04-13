import type { SpatialData } from "../core/types.js";

/** Axis identifier — full or half */
export type InputAxis =
  | "tx" | "ty" | "tz" | "rx" | "ry" | "rz" | "w"
  | "tx+" | "ty+" | "tz+" | "rx+" | "ry+" | "rz+" | "w+"
  | "tx-" | "ty-" | "tz-" | "rx-" | "ry-" | "rz-" | "w-";

/** The 7 full output axes (6DOF + W) */
export const FULL_AXES: InputAxis[] = ["tx", "ty", "tz", "rx", "ry", "rz", "w"];

/** A single axis route — reads from source, writes to target */
export interface AxisRoute {
  source: InputAxis;
  target: InputAxis;
  /** Negate the value (default: false) */
  flip?: boolean;
}

/** Default 6DOF passthrough */
export const DEFAULT_ROUTES: AxisRoute[] = [
  { source: "tx", target: "tx" },
  { source: "ty", target: "ty" },
  { source: "tz", target: "tz" },
  { source: "rx", target: "rx" },
  { source: "ry", target: "ry" },
  { source: "rz", target: "rz" },
];

/** Build passthrough routes from a device's axis list. Half-axes target their base axis.
 *  Negative half-axes (e.g., "ty-") get flip: true. */
export function buildRoutes(axes: string[]): AxisRoute[] {
  return axes.map((axis) => {
    const base = axis.replace(/[+-]$/, "");
    const flip = axis.endsWith("-");
    return { source: axis as InputAxis, target: base as InputAxis, ...(flip && { flip: true }) };
  });
}

/** Read a value from SpatialData by axis name. Half-axes read the same as the full axis. */
function readAxis(data: SpatialData, axis: InputAxis): number {
  const base = axis.replace(/[+-]$/, "");
  switch (base) {
    case "tx": return data.translation.x;
    case "ty": return data.translation.y;
    case "tz": return data.translation.z;
    case "rx": return data.rotation.x;
    case "ry": return data.rotation.y;
    case "rz": return data.rotation.z;
    case "w":  return data.w ?? 0;
    default: return 0;
  }
}

/** Accumulator for applyRoutes */
interface RouteAccum {
  t: { x: number; y: number; z: number };
  r: { x: number; y: number; z: number };
  w: number;
}

/** Write a value to accumulators. Half-axis targets: "tz+" adds, "tz-" subtracts. */
function writeAxis(acc: RouteAccum, axis: InputAxis, value: number): void {
  const isNeg = axis.endsWith("-");
  const base = axis.replace(/[+-]$/, "");
  const sign = isNeg ? -1 : 1;
  if (base === "w") { acc.w += value * sign; return; }
  const group = base[0] as "t" | "r";
  const key = base[1] as "x" | "y" | "z";
  if (group === "t") acc.t[key] += value * sign;
  else acc.r[key] += value * sign;
}

/** Apply routes to SpatialData. Multiple routes targeting the same axis accumulate. */
export function applyRoutes(data: SpatialData, routes: AxisRoute[], translateScale = 1, rotateScale = 1, wScale = 1): SpatialData {
  const acc: RouteAccum = { t: { x: 0, y: 0, z: 0 }, r: { x: 0, y: 0, z: 0 }, w: 0 };

  for (const route of routes) {
    let value = readAxis(data, route.source);
    if (route.flip) value = -value;
    const targetBase = route.target.replace(/[+-]$/, "");
    const scale = targetBase === "w" ? wScale : targetBase[0] === "t" ? translateScale : rotateScale;
    value *= scale;
    writeAxis(acc, route.target, value);
  }

  return { translation: acc.t, rotation: acc.r, w: acc.w || undefined, timestamp: data.timestamp, deviceId: data.deviceId };
}
