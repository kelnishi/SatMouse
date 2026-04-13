import { DEFAULT_ROUTES, type AxisRoute } from "./action-map.js";

/** Maps a device button to a keyboard key */
export interface ButtonRoute {
  /** Device button index */
  button: number;
  /** Keyboard key value (KeyboardEvent.key, e.g., "a", "Shift", "ArrowUp") */
  key: string;
  /** Keyboard code (KeyboardEvent.code, e.g., "KeyA", "ShiftLeft"). Optional. */
  code?: string;
}

/** Per-device configuration */
export interface DeviceConfig {
  /** Axis routing — each entry maps a device input to an output with optional flip */
  routes?: AxisRoute[];
  /** Button-to-key mappings */
  buttonRoutes?: ButtonRoute[];
  /** Scale multiplier for translation axes (tx, ty, tz) */
  translateScale?: number;
  /** Scale multiplier for rotation axes (rx, ry, rz) */
  rotateScale?: number;
  /** Scale multiplier for W axis */
  wScale?: number;
  /** Dead zone threshold (0-1). Values below this are zeroed. */
  deadZone?: number;
  /** Only pass the strongest axis, zero all others */
  dominant?: boolean;
}

/** Global configuration */
export interface InputConfig {
  /** Default axis routes (used when device has no override) */
  routes: AxisRoute[];
  /** Default button-to-key mappings */
  buttonRoutes: ButtonRoute[];
  /** Scale multiplier for translation axes */
  translateScale: number;
  /** Scale multiplier for rotation axes */
  rotateScale: number;
  /** Scale multiplier for W axis */
  wScale: number;
  /** Dead zone threshold */
  deadZone: number;
  /** Dominant axis mode */
  dominant: boolean;
  /** Lock translation to zero */
  lockPosition: boolean;
  /** Lock rotation to zero */
  lockRotation: boolean;
  /** Per-device overrides keyed by device ID or pattern (e.g., "cnx-*") */
  devices: Record<string, DeviceConfig>;
}

export const DEFAULT_CONFIG: InputConfig = {
  routes: DEFAULT_ROUTES,
  buttonRoutes: [],
  translateScale: 0.001,
  rotateScale: 0.001,
  wScale: 0.001,
  deadZone: 0,
  dominant: false,
  lockPosition: false,
  lockRotation: false,
  devices: {
    "cnx-*": {
      routes: [
        { source: "tx", target: "tx" },
        { source: "ty", target: "ty", flip: true },
        { source: "tz", target: "tz", flip: true },
        { source: "rx", target: "rx" },
        { source: "ry", target: "ry", flip: true },
        { source: "rz", target: "rz", flip: true },
      ],
    },
    // PlayStation: L2 (ty) → TY, R2 (ry) → TY flipped (push-pull)
    "hid-54c-*": {
      routes: [
        { source: "tx", target: "tx" },
        { source: "tz", target: "tz" },
        { source: "rz", target: "rz" },
        { source: "rx", target: "rx" },
        { source: "ty", target: "ty" },
        { source: "ry", target: "ty", flip: true },
      ],
    },
  },
};

export function mergeConfig(base: InputConfig, partial: Partial<InputConfig>): InputConfig {
  const merged = {
    ...base,
    ...partial,
    routes: partial.routes ?? [...base.routes],
    buttonRoutes: partial.buttonRoutes ?? [...base.buttonRoutes],
    devices: { ...base.devices },
  };

  if (partial.devices) {
    for (const [key, devCfg] of Object.entries(partial.devices)) {
      merged.devices[key] = { ...merged.devices[key], ...devCfg };
    }
  }

  return merged;
}

/** Resolve the effective config for a specific device */
export function resolveDeviceConfig(config: InputConfig, deviceId: string): InputConfig {
  let deviceOverride: DeviceConfig | undefined;

  if (config.devices[deviceId]) {
    deviceOverride = config.devices[deviceId];
  } else {
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
    routes: deviceOverride.routes ?? config.routes,
    buttonRoutes: deviceOverride.buttonRoutes ?? config.buttonRoutes,
    translateScale: deviceOverride.translateScale ?? config.translateScale,
    rotateScale: deviceOverride.rotateScale ?? config.rotateScale,
    wScale: deviceOverride.wScale ?? config.wScale,
    deadZone: deviceOverride.deadZone ?? config.deadZone,
    dominant: deviceOverride.dominant ?? config.dominant,
  };
}
