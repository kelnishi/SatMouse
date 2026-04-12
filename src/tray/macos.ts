import { nativeRequire } from "../native-require.js";
import type { Tray, TrayActions } from "./types.js";

const OBJC_PATH = "/usr/lib/libobjc.A.dylib";

/**
 * macOS menu bar (NSStatusItem) tray via koffi + ObjC runtime.
 *
 * Shows a "🛰" icon in the menu bar with a dropdown:
 *   - Open Client (opens browser)
 *   - Quit SatMouse
 *
 * Pumps the NSApplication event loop on an interval so AppKit UI
 * (menus, status items) actually renders and responds to clicks.
 */
export class MacOSTray implements Tray {
  private callbackHandles: any[] = [];
  private eventPump: ReturnType<typeof setInterval> | null = null;

  start(actions: TrayActions): void {
    const koffi: any = nativeRequire("koffi");
    const objc = koffi.load(OBJC_PATH);

    // ObjC runtime functions
    const objc_getClass = objc.func("void *objc_getClass(const char *name)");
    const sel = objc.func("void *sel_registerName(const char *name)");
    const msg = objc.func("void *objc_msgSend(void *self, void *sel)");
    const msg_p = objc.func("void *objc_msgSend(void *self, void *sel, void *a)");
    const msg_d = objc.func("void *objc_msgSend(void *self, void *sel, double a)");
    const msg_pp = objc.func("void *objc_msgSend(void *self, void *sel, void *a, void *b)");
    const msg_ppp = objc.func("void *objc_msgSend(void *self, void *sel, void *a, void *b, void *c)");
    // For nextEventMatchingMask:untilDate:inMode:dequeue: (unsigned long long, id, id, bool)
    const msg_Qppb = objc.func("void *objc_msgSend(void *self, void *sel, uint64_t a, void *b, void *c, bool d)");

    // Class creation for action target
    const objc_allocateClassPair = objc.func(
      "void *objc_allocateClassPair(void *superclass, const char *name, unsigned long extraBytes)"
    );
    const class_addMethod = objc.func(
      "bool class_addMethod(void *cls, void *name, void *imp, const char *types)"
    );
    const objc_registerClassPair = objc.func("void objc_registerClassPair(void *cls)");

    // Helper: create NSString from JS string
    const NSStringClass = objc_getClass("NSString");
    const str = (s: string) =>
      msg_p(
        msg(NSStringClass, sel("alloc")),
        sel("initWithUTF8String:"),
        Buffer.from(s + "\0", "utf-8")
      );

    // ---- Create action handler class ----
    const NSObject = objc_getClass("NSObject");
    const TargetClass = objc_allocateClassPair(NSObject, "SatMouseMenuTarget", 0);

    // ObjC method signature: void method(id self, SEL _cmd, id sender) → "v@:@"
    const ActionProto = koffi.proto("void ObjCAction(void *self, void *_cmd, void *sender)");

    const openClientCb = koffi.register(
      () => { actions.onOpenClient(); },
      koffi.pointer(ActionProto)
    );
    const rescanCb = koffi.register(
      () => { actions.onRescanDevices(); },
      koffi.pointer(ActionProto)
    );
    const quitCb = koffi.register(
      () => { actions.onQuit(); },
      koffi.pointer(ActionProto)
    );

    class_addMethod(TargetClass, sel("openClient:"), openClientCb, "v@:@");
    class_addMethod(TargetClass, sel("rescanDevices:"), rescanCb, "v@:@");
    class_addMethod(TargetClass, sel("quitApp:"), quitCb, "v@:@");
    objc_registerClassPair(TargetClass);

    const target = msg(msg(TargetClass, sel("alloc")), sel("init"));

    // ---- Create menu ----
    const NSMenu = objc_getClass("NSMenu");
    const NSMenuItem = objc_getClass("NSMenuItem");

    const menu = msg_p(msg(NSMenu, sel("alloc")), sel("initWithTitle:"), str("SatMouse"));

    // "Open Client" item
    const openItem = msg_ppp(
      msg(NSMenuItem, sel("alloc")),
      sel("initWithTitle:action:keyEquivalent:"),
      str("Open Client"),
      sel("openClient:"),
      str("")
    );
    msg_p(openItem, sel("setTarget:"), target);
    msg_p(menu, sel("addItem:"), openItem);

    // "Rescan Devices" item
    const rescanItem = msg_ppp(
      msg(NSMenuItem, sel("alloc")),
      sel("initWithTitle:action:keyEquivalent:"),
      str("Rescan Devices"),
      sel("rescanDevices:"),
      str("")
    );
    msg_p(rescanItem, sel("setTarget:"), target);
    msg_p(menu, sel("addItem:"), rescanItem);

    // Separator
    msg_p(menu, sel("addItem:"), msg(NSMenuItem, sel("separatorItem")));

    // "Quit SatMouse" item
    const quitItem = msg_ppp(
      msg(NSMenuItem, sel("alloc")),
      sel("initWithTitle:action:keyEquivalent:"),
      str("Quit SatMouse"),
      sel("quitApp:"),
      str("")
    );
    msg_p(quitItem, sel("setTarget:"), target);
    msg_p(menu, sel("addItem:"), quitItem);

    // ---- Create status bar item ----
    const NSStatusBar = objc_getClass("NSStatusBar");
    const statusBar = msg(NSStatusBar, sel("systemStatusBar"));

    // NSVariableStatusItemLength = -2
    const statusItem = msg_d(statusBar, sel("statusItemWithLength:"), -2.0);

    const button = msg(statusItem, sel("button"));
    msg_p(button, sel("setTitle:"), str("🛰"));

    msg_p(statusItem, sel("setMenu:"), menu);

    // ---- Pump NSApp event loop ----
    // AppKit UI (menus, clicks) requires NSApplication to process events.
    // We drain pending events on an interval so the menu bar actually works.
    const NSApp = msg(objc_getClass("NSApplication"), sel("sharedApplication"));
    const NSDefaultRunLoopMode = str("kCFRunLoopDefaultMode");
    const NSEventMaskAny = BigInt("0xFFFFFFFFFFFFFFFF");

    this.eventPump = setInterval(() => {
      // Drain all pending UI events
      while (true) {
        const event = msg_Qppb(
          NSApp,
          sel("nextEventMatchingMask:untilDate:inMode:dequeue:"),
          NSEventMaskAny,
          null,               // untilDate: nil (don't block)
          NSDefaultRunLoopMode,
          true                // dequeue
        );
        if (!event) break;
        msg_p(NSApp, sel("sendEvent:"), event);
      }
    }, 16); // ~60 Hz — smooth menu interaction

    // Keep references to prevent GC
    this.callbackHandles = [openClientCb, rescanCb, quitCb, statusItem, target, menu, NSApp];

    console.log("[Tray] Menu bar item active");
  }

  stop(): void {
    if (this.eventPump) {
      clearInterval(this.eventPump);
      this.eventPump = null;
    }
    this.callbackHandles = [];
  }
}
