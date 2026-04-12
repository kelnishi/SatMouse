import { nativeRequire } from "./native-require.js";

const OBJC_PATH = "/usr/lib/libobjc.A.dylib";

let initialized = false;

/**
 * Bootstrap NSApplication (macOS only).
 * Must be called once before any AppKit or 3Dconnexion framework usage.
 * Sets activation policy to Accessory (no dock icon, menu bar only).
 */
export function ensureNSApp(): void {
  if (initialized || process.platform !== "darwin") return;
  initialized = true;

  const koffi: any = nativeRequire("koffi");
  const objc = koffi.load(OBJC_PATH);

  const objc_getClass = objc.func("void *objc_getClass(const char *name)");
  const sel = objc.func("void *sel_registerName(const char *name)");
  const msg = objc.func("void *objc_msgSend(void *self, void *sel)");
  const msg_l = objc.func("void *objc_msgSend(void *self, void *sel, long arg)");

  const NSApp = msg(objc_getClass("NSApplication"), sel("sharedApplication"));
  // Accessory = 1: no dock icon, but can show menu bar items
  msg_l(NSApp, sel("setActivationPolicy:"), 1);
  msg_l(NSApp, sel("activateIgnoringOtherApps:"), 1);
}
