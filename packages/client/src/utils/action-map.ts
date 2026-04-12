import type { SpatialData } from "../core/types.js";

/** Axis identifier — full or half */
export type InputAxis =
  | "tx" | "ty" | "tz" | "rx" | "ry" | "rz"
  | "tx+" | "ty+" | "tz+" | "rx+" | "ry+" | "rz+"
  | "tx-" | "ty-" | "tz-" | "rx-" | "ry-" | "rz-";

/** The 6 full output axes */
export const FULL_AXES: InputAxis[] = ["tx", "ty", "tz", "rx", "ry", "rz"];

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
    default: return 0;
  }
}

/** Write a value to accumulators. Half-axis targets: "tz+" adds, "tz-" subtracts. */
function writeAxis(t: { x: number; y: number; z: number }, r: { x: number; y: number; z: number }, axis: InputAxis, value: number): void {
  const isNeg = axis.endsWith("-");
  const base = axis.replace(/[+-]$/, "");
  const sign = isNeg ? -1 : 1;
  const group = base[0] as "t" | "r";
  const key = base[1] as "x" | "y" | "z";
  if (group === "t") t[key] += value * sign;
  else r[key] += value * sign;
}

/** Apply routes to SpatialData. Multiple routes targeting the same axis accumulate.
 *  @param scale — global scale multiplier applied to all routes */
export function applyRoutes(data: SpatialData, routes: AxisRoute[], scale = 1): SpatialData {
  const t = { x: 0, y: 0, z: 0 };
  const r = { x: 0, y: 0, z: 0 };

  for (const route of routes) {
    let value = readAxis(data, route.source);
    if (route.flip) value = -value;
    value *= scale;
    writeAxis(t, r, route.target, value);
  }

  return { translation: t, rotation: r, timestamp: data.timestamp, deviceId: data.deviceId };
}
