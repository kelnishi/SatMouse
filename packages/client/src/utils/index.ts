export { InputManager } from "./input-manager.js";
export type { InputManagerEvents, DeviceWithConfig } from "./input-manager.js";
export { DEFAULT_CONFIG, mergeConfig, resolveDeviceConfig } from "./config.js";
export type { InputConfig, DeviceConfig } from "./config.js";
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
