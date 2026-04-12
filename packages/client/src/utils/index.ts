export { InputManager } from "./input-manager.js";
export type { InputManagerEvents, DeviceWithConfig } from "./input-manager.js";
export { DEFAULT_CONFIG, mergeConfig, resolveDeviceConfig } from "./config.js";
export type { InputConfig, DeviceConfig } from "./config.js";
export { saveSettings, loadSettings } from "./persistence.js";
export type { StorageAdapter } from "./persistence.js";
export { applyRoutes, buildRoutes, DEFAULT_ROUTES, FULL_AXES } from "./action-map.js";
export type { AxisRoute, InputAxis } from "./action-map.js";
