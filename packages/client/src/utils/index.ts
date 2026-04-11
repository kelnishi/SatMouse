export { InputManager } from "./input-manager.js";
export type { InputManagerEvents } from "./input-manager.js";
export { DEFAULT_CONFIG, mergeConfig } from "./config.js";
export type { InputConfig } from "./config.js";
export {
  applyFlip,
  applySensitivity,
  applyDominant,
  applyDeadZone,
  applyAxisRemap,
  DEFAULT_AXIS_MAP,
} from "./transforms.js";
export type { FlipConfig, SensitivityConfig, AxisMap } from "./transforms.js";
export { saveSettings, loadSettings } from "./persistence.js";
export type { StorageAdapter } from "./persistence.js";
