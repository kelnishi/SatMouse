import type { FlipConfig, SensitivityConfig, AxisMap } from "./transforms.js";

export interface InputConfig {
  sensitivity: SensitivityConfig;
  flip: FlipConfig;
  deadZone: number;
  dominant: boolean;
  axisRemap: AxisMap;
  lockPosition: boolean;
  lockRotation: boolean;
}

export const DEFAULT_CONFIG: InputConfig = {
  sensitivity: { translation: 0.001, rotation: 0.001 },
  flip: { tx: false, ty: true, tz: true, rx: false, ry: true, rz: true },
  deadZone: 0,
  dominant: false,
  axisRemap: { tx: "x", ty: "y", tz: "z", rx: "x", ry: "y", rz: "z" },
  lockPosition: false,
  lockRotation: false,
};

export function mergeConfig(base: InputConfig, partial: Partial<InputConfig>): InputConfig {
  return {
    ...base,
    ...partial,
    sensitivity: { ...base.sensitivity, ...partial.sensitivity },
    flip: { ...base.flip, ...partial.flip },
    axisRemap: { ...base.axisRemap, ...partial.axisRemap },
  };
}
