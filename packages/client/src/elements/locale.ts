/** All localizable strings used by SatMouse Web Components. */
export interface SatMouseLocale {
  // satmouse-status
  connected: string;
  connecting: string;
  disconnected: string;
  notRunning: string;
  extensionRequired: string;
  launchSatMouse: string;
  downloadSatMouse: string;
  enableExtension: string;

  // satmouse-devices
  noDevices: string;
  flip: string;
  translateScale: string;
  rotateScale: string;
  wScale: string;
  buttonMappings: string;
  remapKey: string;
  pressAKey: string;
  remove: string;
  addButtonMapping: string;
  pressDeviceButton: string;
  restoreDefaults: string;

  // satmouse-debug
  fps: string;
}

/** Default English strings. Exported so implementors can iterate keys for translation tooling. */
export const DEFAULT_LOCALE: Readonly<SatMouseLocale> = {
  // satmouse-status
  connected: "Connected",
  connecting: "Connecting...",
  disconnected: "Disconnected",
  notRunning: "Not running",
  extensionRequired: "Extension required",
  launchSatMouse: "Launch SatMouse",
  downloadSatMouse: "Download SatMouse",
  enableExtension: "Enable Extension",

  // satmouse-devices
  noDevices: "No devices",
  flip: "Flip",
  translateScale: "Trans",
  rotateScale: "Rot",
  wScale: "W",
  buttonMappings: "Button Mappings",
  remapKey: "Remap key",
  pressAKey: "Press a key...",
  remove: "Remove",
  addButtonMapping: "+ Add Button Mapping",
  pressDeviceButton: "Press a device button...",
  restoreDefaults: "Restore Defaults",

  // satmouse-debug
  fps: "fps",
};

let current: SatMouseLocale = { ...DEFAULT_LOCALE };

/** Override some or all UI strings. Partial updates merge with the current locale. */
export function setLocale(overrides: Partial<SatMouseLocale>): void {
  current = { ...current, ...overrides };
}

/** Get the current locale strings. */
export function getLocale(): Readonly<SatMouseLocale> {
  return current;
}

/** Read a single string by key. Used internally by components. */
export function t(key: keyof SatMouseLocale): string {
  return current[key];
}
