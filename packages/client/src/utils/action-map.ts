import type { SpatialData } from "../core/types.js";

/** Input axis identifier */
export type InputAxis = "tx" | "ty" | "tz" | "rx" | "ry" | "rz";

/** A single action binding — maps one input axis to a named output */
export interface ActionBinding {
  /** Which input axis drives this action */
  source: InputAxis;
  /** Scale multiplier (default: 1) */
  scale?: number;
  /** Invert the value (default: false) */
  invert?: boolean;
}

/**
 * ActionMap defines how raw 6DOF axes map to named output actions.
 *
 * Client apps declare the actions they support and how device axes
 * feed into them. Users can reassign axes via the settings UI.
 *
 * Default: 6 actions matching the 6 input axes (passthrough).
 */
export type ActionMap = Record<string, ActionBinding>;

/** Default passthrough — each axis maps to itself */
export const DEFAULT_ACTION_MAP: ActionMap = {
  tx: { source: "tx" },
  ty: { source: "ty" },
  tz: { source: "tz" },
  rx: { source: "rx" },
  ry: { source: "ry" },
  rz: { source: "rz" },
};

/** Result of applying an ActionMap to spatial data */
export type ActionValues = Record<string, number>;

/** Read a raw axis value from SpatialData */
function readAxis(data: SpatialData, axis: InputAxis): number {
  switch (axis) {
    case "tx": return data.translation.x;
    case "ty": return data.translation.y;
    case "tz": return data.translation.z;
    case "rx": return data.rotation.x;
    case "ry": return data.rotation.y;
    case "rz": return data.rotation.z;
  }
}

/** Apply an ActionMap to SpatialData, producing named action values */
export function applyActionMap(data: SpatialData, map: ActionMap): ActionValues {
  const result: ActionValues = {};
  for (const [action, binding] of Object.entries(map)) {
    let value = readAxis(data, binding.source);
    if (binding.invert) value = -value;
    value *= binding.scale ?? 1;
    result[action] = value;
  }
  return result;
}

/**
 * Convert ActionValues back to SpatialData.
 * Only populates tx/ty/tz/rx/ry/rz keys if they exist as actions.
 */
export function actionValuesToSpatialData(values: ActionValues, timestamp: number): SpatialData {
  return {
    translation: {
      x: values.tx ?? 0,
      y: values.ty ?? 0,
      z: values.tz ?? 0,
    },
    rotation: {
      x: values.rx ?? 0,
      y: values.ry ?? 0,
      z: values.rz ?? 0,
    },
    timestamp,
  };
}

/** Swap two action bindings */
export function swapActions(map: ActionMap, actionA: string, actionB: string): ActionMap {
  const result = { ...map };
  const a = result[actionA];
  const b = result[actionB];
  if (a && b) {
    result[actionA] = b;
    result[actionB] = a;
  }
  return result;
}
