import { nativeRequire } from "./native-require.js";

const OBJC_PATH = "/usr/lib/libobjc.A.dylib";
const APPKIT_PATH = "/System/Library/Frameworks/AppKit.framework/AppKit";

let initialized = false;

/**
 * Bootstrap NSApplication (macOS only).
 * Must be called once before any AppKit or 3Dconnexion framework usage.
 *
 * Critical: AppKit.framework must be loaded BEFORE calling
 * objc_getClass("NSApplication") — otherwise the class doesn't exist
 * in the ObjC runtime and sharedApplication returns null.
 */
export function ensureNSApp(): void {
  if (initialized || process.platform !== "darwin") return;
  initialized = true;

  const koffi: any = nativeRequire("koffi");

  // Load AppKit into the process — required for NSApplication, NSStatusBar, etc.
  koffi.load(APPKIT_PATH);

  const objc = koffi.load(OBJC_PATH);
  const objc_getClass = objc.func("void *objc_getClass(const char *name)");
  const sel = objc.func("void *sel_registerName(const char *name)");
  const msg = objc.func("void *objc_msgSend(void *self, void *sel)");
  const msg_l = objc.func("void *objc_msgSend(void *self, void *sel, long arg)");

  const NSApp = msg(objc_getClass("NSApplication"), sel("sharedApplication"));

  // Start as Regular to register with the window server, then switch to Accessory
  msg_l(NSApp, sel("setActivationPolicy:"), 0);
  msg(NSApp, sel("finishLaunching"));
  msg_l(NSApp, sel("activateIgnoringOtherApps:"), 1);
  msg_l(NSApp, sel("setActivationPolicy:"), 1); // Accessory: no dock icon
}
