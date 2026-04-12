import type { FlipConfig, SensitivityConfig, AxisMap } from "./transforms.js";
import { DEFAULT_ACTION_MAP, type ActionMap } from "./action-map.js";

/** Per-device transform overrides. Any field left undefined inherits from global defaults. */
export interface DeviceConfig {
  sensitivity?: Partial<SensitivityConfig>;
  flip?: Partial<FlipConfig>;
  deadZone?: number;
  dominant?: boolean;
  axisRemap?: Partial<AxisMap>;
  actionMap?: ActionMap;
  lockPosition?: boolean;
  lockRotation?: boolean;
}

export interface InputConfig {
  /** Global defaults applied to all devices */
  sensitivity: SensitivityConfig;
  flip: FlipConfig;
  deadZone: number;
  dominant: boolean;
  axisRemap: AxisMap;
  lockPosition: boolean;
  lockRotation: boolean;

  /** Action map — maps input axes to named output actions. Default: passthrough. */
  actionMap: ActionMap;

  /**
   * Per-device overrides, keyed by device ID (e.g., "spacemouse-c635")
   * or device family pattern (e.g., "spacemouse-*", "hid-054c-*").
   * Values override global defaults for matching devices.
   */
  devices: Record<string, DeviceConfig>;
}

export const DEFAULT_CONFIG: InputConfig = {
  sensitivity: { translation: 0.001, rotation: 0.001 },
  flip: { tx: false, ty: false, tz: false, rx: false, ry: false, rz: false },
  deadZone: 0,
  dominant: false,
  axisRemap: { tx: "x", ty: "y", tz: "z", rx: "x", ry: "y", rz: "z" },
  lockPosition: false,
  lockRotation: false,
  actionMap: { ...DEFAULT_ACTION_MAP },
  devices: {
    // SpaceMouse Z-up → Three.js Y-up axis correction
    "cnx-*": { flip: { ty: true, tz: true, ry: true, rz: true } },
  },
};

export function mergeConfig(base: InputConfig, partial: Partial<InputConfig>): InputConfig {
  const merged = {
    ...base,
    ...partial,
    sensitivity: { ...base.sensitivity, ...partial.sensitivity },
    flip: { ...base.flip, ...partial.flip },
    axisRemap: { ...base.axisRemap, ...partial.axisRemap },
    actionMap: partial.actionMap ? { ...base.actionMap, ...partial.actionMap } : { ...base.actionMap },
    devices: { ...base.devices },
  };

  // Merge per-device configs
  if (partial.devices) {
    for (const [key, devCfg] of Object.entries(partial.devices)) {
      merged.devices[key] = mergeDeviceConfig(merged.devices[key], devCfg);
    }
  }

  return merged;
}

export function mergeDeviceConfig(base: DeviceConfig | undefined, partial: DeviceConfig): DeviceConfig {
  if (!base) return partial;
  return {
    ...base,
    ...partial,
    sensitivity: partial.sensitivity ? { ...base.sensitivity, ...partial.sensitivity } : base.sensitivity,
    flip: partial.flip ? { ...base.flip, ...partial.flip } : base.flip,
    axisRemap: partial.axisRemap ? { ...base.axisRemap, ...partial.axisRemap } : base.axisRemap,
  };
}

/** Resolve the effective config for a specific device by merging global + device overrides */
export function resolveDeviceConfig(config: InputConfig, deviceId: string): InputConfig {
  // Find matching device config: exact match first, then pattern match
  let deviceOverride: DeviceConfig | undefined;

  if (config.devices[deviceId]) {
    deviceOverride = config.devices[deviceId];
  } else {
    // Try pattern match (e.g., "spacemouse-*" matches "spacemouse-c635")
    for (const [pattern, cfg] of Object.entries(config.devices)) {
      if (pattern.endsWith("*") && deviceId.startsWith(pattern.slice(0, -1))) {
        deviceOverride = cfg;
        break;
      }
    }
  }

  if (!deviceOverride) return config;

  return {
    ...config,
    sensitivity: { ...config.sensitivity, ...deviceOverride.sensitivity },
    flip: { ...config.flip, ...deviceOverride.flip },
    deadZone: deviceOverride.deadZone ?? config.deadZone,
    dominant: deviceOverride.dominant ?? config.dominant,
    axisRemap: { ...config.axisRemap, ...deviceOverride.axisRemap },
    actionMap: deviceOverride.actionMap ? { ...config.actionMap, ...deviceOverride.actionMap } : config.actionMap,
    lockPosition: deviceOverride.lockPosition ?? config.lockPosition,
    lockRotation: deviceOverride.lockRotation ?? config.lockRotation,
  };
}
