import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { DeviceInfo } from "../../types.js";
import type { PlatformDriver } from "./index.js";

const require = createRequire(import.meta.url);

const FRAMEWORK_PATH = "/Library/Frameworks/3DconnexionClient.framework/3DconnexionClient";
const CF_PATH = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";
const OBJC_PATH = "/usr/lib/libobjc.A.dylib";

// Constants from ConnexionClient.h
const kConnexionClientManual = 0x2b2b2b2b; // '++++' — manual activation mode
const kConnexionClientModeTakeOver = 1;
const kConnexionMaskAll = 0x3fff;
const kConnexionMaskAllButtons = 0xffffffff;
const kConnexionMsgDeviceState = 0x33645352; // '3dSR'
const kConnexionCmdHandleAxis = 3;
const kConnexionCmdHandleButtons = 2;
const kConnexionCtlActivateClient = 0x33646163; // '3dac'

/**
 * macOS driver for 3DConnexion SpaceMouse via 3DconnexionClient.framework.
 *
 * The 3DxWare driver only sends axis/button events to the active client.
 * Since Node.js is not a GUI app, we:
 * 1. Bootstrap NSApplication (via ObjC runtime) so the framework recognizes us
 * 2. Register with kConnexionClientManual signature
 * 3. Force-activate with ConnexionClientControl(kConnexionCtlActivateClient)
 * 4. Pump CFRunLoop to receive callbacks
 */
export class MacOSDriver implements PlatformDriver {
  onSpatialData: PlatformDriver["onSpatialData"] = null;
  onButtonChange: PlatformDriver["onButtonChange"] = null;
  onDeviceAdded: PlatformDriver["onDeviceAdded"] = null;
  onDeviceRemoved: PlatformDriver["onDeviceRemoved"] = null;

  private clientId: number = 0;
  private runLoopTimer: ReturnType<typeof setInterval> | null = null;
  private prevButtons: number = 0;
  private devices: DeviceInfo[] = [];

  private fnUnregister: ((clientID: number) => void) | null = null;
  private fnCleanup: (() => void) | null = null;
  private callbackHandles: any[] = [];

  probe(): boolean {
    return existsSync(FRAMEWORK_PATH);
  }

  async connect(): Promise<void> {
    const koffi: any = require("koffi");

    // ---- Bootstrap NSApplication ----
    // The 3DConnexion framework requires an NSApplication to deliver events.
    const objcLib = koffi.load(OBJC_PATH);
    const objc_getClass = objcLib.func("void *objc_getClass(const char *name)");
    const sel_registerName = objcLib.func("void *sel_registerName(const char *name)");
    const objc_msgSend = objcLib.func("void *objc_msgSend(void *self, void *sel)");
    const objc_msgSend_l = objcLib.func("void *objc_msgSend(void *self, void *sel, long arg)");

    const NSApp = objc_msgSend(objc_getClass("NSApplication"), sel_registerName("sharedApplication"));
    // NSApplicationActivationPolicyAccessory = 1 (no dock icon, menu bar only)
    objc_msgSend_l(NSApp, sel_registerName("setActivationPolicy:"), 1);
    objc_msgSend_l(NSApp, sel_registerName("activateIgnoringOtherApps:"), 1);

    // ---- Load framework ----
    const lib = koffi.load(FRAMEWORK_PATH);
    const cfLib = koffi.load(CF_PATH);

    // ConnexionDeviceState is #pragma pack(push,2) — 48 bytes.
    // koffi doesn't support struct packing, so we read raw bytes at known offsets.
    // Layout:
    //   0: uint16 version    2: uint16 client     4: uint16 command
    //   6: int16  param      8: int32  value      12: uint64 time
    //  20: uint8[8] report  28: uint16 buttons8
    //  30: int16[6] axis    42: uint16 address    44: uint32 buttons
    const STRUCT_SIZE = 48;
    const OFF_COMMAND = 4;
    const OFF_AXIS = 30;
    const OFF_BUTTONS = 44;

    // Callback prototypes
    const MessageHandlerProto = koffi.proto(
      "void ConnexionMessageHandler(unsigned int productID, unsigned int messageType, void *messageArgument)"
    );
    const AddedHandlerProto = koffi.proto(
      "void ConnexionAddedHandler(unsigned int productID)"
    );
    const RemovedHandlerProto = koffi.proto(
      "void ConnexionRemovedHandler(unsigned int productID)"
    );

    // Framework functions
    const SetConnexionHandlers = lib.func(
      "int16_t SetConnexionHandlers(ConnexionMessageHandler *mh, ConnexionAddedHandler *ah, ConnexionRemovedHandler *rh, bool useSeparateThread)"
    );
    const RegisterConnexionClient = lib.func(
      "uint16_t RegisterConnexionClient(uint32_t signature, uint8_t *name, uint16_t mode, uint32_t mask)"
    );
    const SetConnexionClientButtonMask = lib.func(
      "void SetConnexionClientButtonMask(uint16_t clientID, uint32_t buttonMask)"
    );
    const ConnexionClientControl = lib.func(
      "int16_t ConnexionClientControl(uint16_t clientID, uint32_t message, int32_t param, int32_t *result)"
    );
    this.fnUnregister = lib.func("void UnregisterConnexionClient(uint16_t clientID)");
    this.fnCleanup = lib.func("void CleanupConnexionHandlers()");

    // CFRunLoop for pumping events
    const CFRunLoopRunInMode = cfLib.func(
      "int32_t CFRunLoopRunInMode(void *mode, double seconds, bool returnAfterSourceHandled)"
    );
    const CFStringCreateWithCString = cfLib.func(
      "void *CFStringCreateWithCString(void *alloc, const char *cStr, uint32_t encoding)"
    );
    const defaultMode = CFStringCreateWithCString(null, "kCFRunLoopDefaultMode", 0x0600);

    // ---- Create callbacks ----
    let loggedFirstEvent = false;
    const messageHandler = koffi.register(
      (productID: number, messageType: number, messageArgument: any) => {
        if (messageType !== kConnexionMsgDeviceState || !messageArgument) return;

        // Read raw bytes from the packed struct (koffi can't handle pack(2))
        const buf = Buffer.from(koffi.decode(messageArgument, koffi.array("uint8_t", STRUCT_SIZE)));

        const command = buf.readUInt16LE(OFF_COMMAND);
        const axes = [
          buf.readInt16LE(OFF_AXIS),
          buf.readInt16LE(OFF_AXIS + 2),
          buf.readInt16LE(OFF_AXIS + 4),
          buf.readInt16LE(OFF_AXIS + 6),
          buf.readInt16LE(OFF_AXIS + 8),
          buf.readInt16LE(OFF_AXIS + 10),
        ];
        const buttons = buf.readUInt32LE(OFF_BUTTONS);

        if (!loggedFirstEvent) {
          console.log(`[SpaceMouse/macOS] First event — cmd: ${command}, axes: [${axes}], buttons: 0x${buttons.toString(16)}`);
          loggedFirstEvent = true;
        }

        switch (command) {
          case kConnexionCmdHandleAxis:
            this.onSpatialData?.(axes[0], axes[1], axes[2], axes[3], axes[4], axes[5]);
            break;

          case kConnexionCmdHandleButtons:
            if (buttons !== this.prevButtons) {
              this.onButtonChange?.(buttons, this.prevButtons);
              this.prevButtons = buttons;
            }
            break;
        }
      },
      koffi.pointer(MessageHandlerProto)
    );

    const addedHandler = koffi.register(
      (productID: number) => {
        const deviceId = `spacemouse-${productID.toString(16)}`;
        this.devices.push({
          id: deviceId,
          name: "SpaceMouse",
          vendorId: 0x046d,
          productId: productID,
        });
        console.log(`[SpaceMouse/macOS] Device added: ${deviceId} (product 0x${productID.toString(16)})`);
        this.onDeviceAdded?.(deviceId);
      },
      koffi.pointer(AddedHandlerProto)
    );

    const removedHandler = koffi.register(
      (productID: number) => {
        const deviceId = `spacemouse-${productID.toString(16)}`;
        this.devices = this.devices.filter((d) => d.id !== deviceId);
        console.log(`[SpaceMouse/macOS] Device removed: ${deviceId}`);
        this.onDeviceRemoved?.(deviceId);
      },
      koffi.pointer(RemovedHandlerProto)
    );

    this.callbackHandles = [messageHandler, addedHandler, removedHandler];

    // ---- Register with framework ----
    const err = SetConnexionHandlers(messageHandler, addedHandler, removedHandler, false);
    if (err !== 0) {
      throw new Error(`SetConnexionHandlers failed with error ${err}`);
    }

    // Use manual mode — allows us to force-activate regardless of foreground state
    this.clientId = RegisterConnexionClient(
      kConnexionClientManual,
      null,
      kConnexionClientModeTakeOver,
      kConnexionMaskAll
    );
    console.log(`[SpaceMouse/macOS] Registered client ID: ${this.clientId}`);

    SetConnexionClientButtonMask(this.clientId, kConnexionMaskAllButtons);

    // Force-activate so the driver sends us events
    const resultBuf = Buffer.alloc(4);
    ConnexionClientControl(this.clientId, kConnexionCtlActivateClient, 0, resultBuf);

    // ---- Pump CFRunLoop ----
    this.runLoopTimer = setInterval(() => {
      CFRunLoopRunInMode(defaultMode, 0.01, false);
    }, 4);
  }

  disconnect(): void {
    if (this.runLoopTimer) {
      clearInterval(this.runLoopTimer);
      this.runLoopTimer = null;
    }
    if (this.clientId && this.fnUnregister) {
      this.fnUnregister(this.clientId);
      this.clientId = 0;
    }
    if (this.fnCleanup) {
      this.fnCleanup();
    }
    this.callbackHandles = [];
    this.devices = [];
  }

  getDevices(): DeviceInfo[] {
    return [...this.devices];
  }
}
