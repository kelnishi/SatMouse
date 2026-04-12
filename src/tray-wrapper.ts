/**
 * Tray wrapper — the .app's main process.
 *
 * Creates the NSStatusItem menu bar icon and spawns the SatMouse
 * server as a child process. This separation is required because:
 * - macOS associates the menu bar icon with the CFBundleExecutable process
 * - The 3Dconnexion framework and code signing interfere with AppKit
 *   when running in the same process in a signed .app bundle
 */

import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { nativeRequire } from "./native-require.js";

const OBJC_PATH = "/usr/lib/libobjc.A.dylib";
const APPKIT_PATH = "/System/Library/Frameworks/AppKit.framework/AppKit";

function main() {
  const koffi: any = nativeRequire("koffi");

  // Load AppKit FIRST
  koffi.load(APPKIT_PATH);
  const objc = koffi.load(OBJC_PATH);

  const cls = objc.func("void *objc_getClass(const char *name)");
  const sel = objc.func("void *sel_registerName(const char *name)");
  const msg = objc.func("void *objc_msgSend(void *self, void *sel)");
  const msg_p = objc.func("void *objc_msgSend(void *self, void *sel, void *a)");
  const msg_d = objc.func("void *objc_msgSend(void *self, void *sel, double a)");
  const msg_l = objc.func("void *objc_msgSend(void *self, void *sel, long a)");
  const msg_ppp = objc.func("void *objc_msgSend(void *self, void *sel, void *a, void *b, void *c)");
  const msg_Qppb = objc.func("void *objc_msgSend(void *self, void *sel, uint64_t a, void *b, void *c, bool d)");

  const objc_allocateClassPair = objc.func("void *objc_allocateClassPair(void *superclass, const char *name, unsigned long extraBytes)");
  const class_addMethod = objc.func("bool class_addMethod(void *cls, void *name, void *imp, const char *types)");
  const objc_registerClassPair = objc.func("void objc_registerClassPair(void *cls)");

  const NSString = cls("NSString");
  const str = (s: string) => msg_p(msg(NSString, sel("alloc")), sel("initWithUTF8String:"), Buffer.from(s + "\0"));

  // Bootstrap NSApp
  const NSApp = msg(cls("NSApplication"), sel("sharedApplication"));
  msg_l(NSApp, sel("setActivationPolicy:"), 0); // Regular first
  msg(NSApp, sel("finishLaunching"));
  msg_l(NSApp, sel("activateIgnoringOtherApps:"), 1);
  msg_l(NSApp, sel("setActivationPolicy:"), 1); // Then Accessory

  // Resolve paths
  const resourcesDir = join(dirname(process.execPath), "..");
  const mainCjs = join(resourcesDir, "main.cjs");
  const nodeExe = process.execPath;

  // Create action handler class
  const ActionProto = koffi.proto("void TrayAction(void *self, void *_cmd, void *sender)");

  const NSObject = cls("NSObject");
  const TargetClass = objc_allocateClassPair(NSObject, "SatMouseTrayTarget", 0);

  let serverProcess: ChildProcess | null = null;

  const openClientCb = koffi.register(() => {
    openBrowser("http://localhost:18945/client/");
  }, koffi.pointer(ActionProto));

  const quitCb = koffi.register(() => {
    serverProcess?.kill();
    process.exit(0);
  }, koffi.pointer(ActionProto));

  class_addMethod(TargetClass, sel("openClient:"), openClientCb, "v@:@");
  class_addMethod(TargetClass, sel("quitApp:"), quitCb, "v@:@");
  objc_registerClassPair(TargetClass);

  const target = msg(msg(TargetClass, sel("alloc")), sel("init"));

  // Create menu
  const NSMenu = cls("NSMenu");
  const NSMenuItem = cls("NSMenuItem");

  const menu = msg_p(msg(NSMenu, sel("alloc")), sel("initWithTitle:"), str("SatMouse"));

  const openItem = msg_ppp(msg(NSMenuItem, sel("alloc")),
    sel("initWithTitle:action:keyEquivalent:"), str("Open Client"), sel("openClient:"), str(""));
  msg_p(openItem, sel("setTarget:"), target);
  msg_p(menu, sel("addItem:"), openItem);

  msg_p(menu, sel("addItem:"), msg(NSMenuItem, sel("separatorItem")));

  const quitItem = msg_ppp(msg(NSMenuItem, sel("alloc")),
    sel("initWithTitle:action:keyEquivalent:"), str("Quit SatMouse"), sel("quitApp:"), str(""));
  msg_p(quitItem, sel("setTarget:"), target);
  msg_p(menu, sel("addItem:"), quitItem);

  // Create status bar item
  const bar = msg(cls("NSStatusBar"), sel("systemStatusBar"));
  const item = msg_d(bar, sel("statusItemWithLength:"), -2.0);
  const button = msg(item, sel("button"));
  msg_p(button, sel("setTitle:"), str("🛰"));
  msg_p(item, sel("setMenu:"), menu);

  console.log("[Tray] Menu bar icon active");

  // Event pump
  const mode = str("kCFRunLoopDefaultMode");
  setInterval(() => {
    for (let i = 0; i < 10; i++) {
      const ev = msg_Qppb(NSApp, sel("nextEventMatchingMask:untilDate:inMode:dequeue:"),
        BigInt("0xFFFFFFFFFFFFFFFF"), null, mode, true);
      if (!ev) break;
      msg_p(NSApp, sel("sendEvent:"), ev);
    }
  }, 16);

  // Spawn the server process
  serverProcess = spawn(nodeExe, [mainCjs], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, SATMOUSE_SKIP_TRAY: "1" },
  });

  serverProcess.on("exit", (code) => {
    console.log(`[Tray] Server exited with code ${code}`);
    process.exit(code ?? 1);
  });

  // Keep refs to prevent GC
  const _refs = [openClientCb, quitCb, item, target, menu, bar];
}

function openBrowser(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
  } catch { return; }
  execFile("open", [url]);
}

main();
