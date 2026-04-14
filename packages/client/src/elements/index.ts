// Side-effect imports — registers custom elements on load
import "./satmouse-status.js";
import "./satmouse-devices.js";
import "./satmouse-debug.js";

export { registerSatMouse, getManager } from "./registry.js";
export { setLocale, getLocale, DEFAULT_LOCALE } from "./locale.js";
export type { SatMouseLocale } from "./locale.js";
export { SatMouseStatus } from "./satmouse-status.js";
export { SatMouseDevices } from "./satmouse-devices.js";
export { SatMouseDebug } from "./satmouse-debug.js";
