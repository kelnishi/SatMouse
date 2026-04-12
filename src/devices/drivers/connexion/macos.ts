import { existsSync } from "node:fs";
import type { DeviceInfo } from "../../types.js";
import { ConnexionDriver } from "./types.js";
import type { ConnexionRawEvent } from "./types.js";
import { buildDeviceInfo } from "./products.js";

const FRAMEWORK_PATH = "/Library/Frameworks/3DconnexionClient.framework/3DconnexionClient";
const OBJC_PATH = "/usr/lib/libobjc.A.dylib";
const CF_PATH = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";

const kConnexionClientManual = 0x2b2b2b2b;
const kConnexionClientModeTakeOver = 1;
const kConnexionMaskAll = 0x3fff;
const kConnexionMaskAllButtons = 0xffffffff;
const kConnexionMsgDeviceState = 0x33645352;
const kConnexionCtlActivateClient = 0x33646163;

// ConnexionDeviceState offsets (pack 2, 48 bytes total)
const STRUCT_SIZE = 48;
const OFF_COMMAND = 4;
const OFF_AXIS = 30;
const OFF_BUTTONS = 44;

/**
 * Shared macOS driver for ALL 3Dconnexion devices via 3DconnexionClient.framework.
 * Dispatches raw events — each plugin filters by product family.
 */
export class MacOSConnexionDriver extends ConnexionDriver {
  private clientId = 0;
  private runLoopTimer: ReturnType<typeof setInterval> | null = null;
  private devices: DeviceInfo[] = [];
  private fnUnregister: ((id: number) => void) | null = null;
  private fnCleanup: (() => void) | null = null;
  private callbackHandles: any[] = [];

  probe(): boolean {
    return existsSync(FRAMEWORK_PATH);
  }

  async connect(): Promise<void> {
    if (this._connected) return;
    const koffi: any = require("koffi");

    // Bootstrap NSApplication
    const objc = koffi.load(OBJC_PATH);
    const objc_getClass = objc.func("void *objc_getClass(const char *name)");
    const sel = objc.func("void *sel_registerName(const char *name)");
    const msg = objc.func("void *objc_msgSend(void *self, void *sel)");
    const msg_l = objc.func("void *objc_msgSend(void *self, void *sel, long arg)");

    const NSApp = msg(objc_getClass("NSApplication"), sel("sharedApplication"));
    msg_l(NSApp, sel("setActivationPolicy:"), 1); // Accessory
    msg_l(NSApp, sel("activateIgnoringOtherApps:"), 1);

    // Load framework
    const lib = koffi.load(FRAMEWORK_PATH);
    const cfLib = koffi.load(CF_PATH);

    // Callback prototypes
    const MsgProto = koffi.proto("void CnxMsg(unsigned int pid, unsigned int type, void *arg)");
    const AddProto = koffi.proto("void CnxAdd(unsigned int pid)");
    const RemProto = koffi.proto("void CnxRem(unsigned int pid)");

    // Framework functions
    const SetConnexionHandlers = lib.func("int16_t SetConnexionHandlers(CnxMsg *m, CnxAdd *a, CnxRem *r, bool sep)");
    const RegisterConnexionClient = lib.func("uint16_t RegisterConnexionClient(uint32_t sig, uint8_t *name, uint16_t mode, uint32_t mask)");
    const SetConnexionClientButtonMask = lib.func("void SetConnexionClientButtonMask(uint16_t id, uint32_t mask)");
    const ConnexionClientControl = lib.func("int16_t ConnexionClientControl(uint16_t id, uint32_t msg, int32_t param, int32_t *result)");
    this.fnUnregister = lib.func("void UnregisterConnexionClient(uint16_t id)");
    this.fnCleanup = lib.func("void CleanupConnexionHandlers()");

    // CFRunLoop
    const CFRunLoopRunInMode = cfLib.func("int32_t CFRunLoopRunInMode(void *mode, double sec, bool ret)");
    const CFStringCreateWithCString = cfLib.func("void *CFStringCreateWithCString(void *a, const char *s, uint32_t e)");
    const defaultMode = CFStringCreateWithCString(null, "kCFRunLoopDefaultMode", 0x0600);

    // Callbacks
    let prevButtons = 0;
    const msgCb = koffi.register(
      (_pid: number, msgType: number, arg: any) => {
        if (msgType !== kConnexionMsgDeviceState || !arg) return;
        const buf = Buffer.from(koffi.decode(arg, koffi.array("uint8_t", STRUCT_SIZE)));
        const event: ConnexionRawEvent = {
          command: buf.readUInt16LE(OFF_COMMAND),
          axes: [
            buf.readInt16LE(OFF_AXIS), buf.readInt16LE(OFF_AXIS + 2), buf.readInt16LE(OFF_AXIS + 4),
            buf.readInt16LE(OFF_AXIS + 6), buf.readInt16LE(OFF_AXIS + 8), buf.readInt16LE(OFF_AXIS + 10),
          ],
          buttons: buf.readUInt32LE(OFF_BUTTONS),
          productId: _pid,
        };
        this.emit("rawEvent", event);
      },
      koffi.pointer(MsgProto)
    );

    const addCb = koffi.register(
      (productId: number) => {
        const deviceId = `cnx-${productId.toString(16)}`;
        const info = buildDeviceInfo(productId, deviceId);
        this.devices.push(info);
        console.log(`[3Dconnexion/macOS] Device added: ${info.model} (${info.connectionType}, 0x${productId.toString(16)})`);
        this.emit("deviceAdded", productId, deviceId);
      },
      koffi.pointer(AddProto)
    );

    const remCb = koffi.register(
      (productId: number) => {
        const deviceId = `cnx-${productId.toString(16)}`;
        this.devices = this.devices.filter((d) => d.id !== deviceId);
        console.log(`[3Dconnexion/macOS] Device removed: ${deviceId}`);
        this.emit("deviceRemoved", deviceId);
      },
      koffi.pointer(RemProto)
    );

    this.callbackHandles = [msgCb, addCb, remCb];

    const err = SetConnexionHandlers(msgCb, addCb, remCb, false);
    if (err !== 0) throw new Error(`SetConnexionHandlers failed: ${err}`);

    this.clientId = RegisterConnexionClient(kConnexionClientManual, null, kConnexionClientModeTakeOver, kConnexionMaskAll);
    SetConnexionClientButtonMask(this.clientId, kConnexionMaskAllButtons);
    ConnexionClientControl(this.clientId, kConnexionCtlActivateClient, 0, Buffer.alloc(4));

    console.log(`[3Dconnexion/macOS] Registered client ID: ${this.clientId}`);

    this.runLoopTimer = setInterval(() => {
      CFRunLoopRunInMode(defaultMode, 0.01, false);
    }, 4);

    this._connected = true;
  }

  disconnect(): void {
    if (this.runLoopTimer) { clearInterval(this.runLoopTimer); this.runLoopTimer = null; }
    if (this.clientId && this.fnUnregister) { this.fnUnregister(this.clientId); this.clientId = 0; }
    this.fnCleanup?.();
    this.callbackHandles = [];
    this.devices = [];
  }

  getDevices(): DeviceInfo[] {
    return [...this.devices];
  }
}
