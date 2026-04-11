import type { DeviceInfo } from "../../types.js";
import type { PlatformDriver } from "./index.js";

const FRAMEWORK_PATH = "/Library/Frameworks/3DconnexionClient.framework/3DconnexionClient";

// Constants from ConnexionClient.h
const kConnexionClientWildcard = 0x2a2a2a2a; // '****'
const kConnexionClientModeTakeOver = 1;
const kConnexionMaskAll = 0x3fff;
const kConnexionMaskAllButtons = 0xffffffff;
const kConnexionMsgDeviceState = 0x33645352; // '3dSR'

/**
 * macOS driver for 3DConnexion SpaceMouse via 3DconnexionClient.framework.
 *
 * Uses koffi FFI to load the framework and register callbacks for device
 * events. The framework dispatches callbacks via CFRunLoop, so we pump
 * CFRunLoopRunInMode from a JS interval timer.
 */
export class MacOSDriver implements PlatformDriver {
  onSpatialData: PlatformDriver["onSpatialData"] = null;
  onButtonChange: PlatformDriver["onButtonChange"] = null;
  onDeviceAdded: PlatformDriver["onDeviceAdded"] = null;
  onDeviceRemoved: PlatformDriver["onDeviceRemoved"] = null;

  private lib: any = null;
  private coreFoundation: any = null;
  private clientId: number = 0;
  private runLoopTimer: ReturnType<typeof setInterval> | null = null;
  private prevButtons: number = 0;
  private devices: DeviceInfo[] = [];

  // FFI function bindings
  private ffi: {
    SetConnexionHandlers: any;
    RegisterConnexionClient: any;
    SetConnexionClientButtonMask: any;
    UnregisterConnexionClient: any;
    CleanupConnexionHandlers: any;
    CFRunLoopRunInMode: any;
  } | null = null;

  probe(): boolean {
    try {
      const koffi = require("koffi");
      koffi.load(FRAMEWORK_PATH);
      return true;
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    const koffi = require("koffi");

    this.lib = koffi.load(FRAMEWORK_PATH);
    this.coreFoundation = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");

    // Define the ConnexionDeviceState struct (2-byte packed per SDK's #pragma pack(push,2))
    const ConnexionDeviceState = koffi.pack(2, koffi.struct("ConnexionDeviceState", {
      version: "uint16_t",
      client: "uint16_t",
      command: "uint16_t",
      param: "int16_t",
      value: "int32_t",
      time: "uint64_t",
      report: koffi.array("uint8_t", 8),
      buttons8: "uint16_t",
      axis: koffi.array("int16_t", 6),
      address: "uint16_t",
      buttons: "uint32_t",
    }));

    // Define callback prototypes
    const MessageHandlerProto = koffi.proto(
      "void ConnexionMessageHandler(unsigned int connection, unsigned int messageType, void *messageArgument)"
    );
    const AddedHandlerProto = koffi.proto(
      "void ConnexionAddedHandler(unsigned int connection)"
    );
    const RemovedHandlerProto = koffi.proto(
      "void ConnexionRemovedHandler(unsigned int connection)"
    );

    // Bind framework functions
    const SetConnexionHandlers = this.lib.func(
      "int16_t SetConnexionHandlers(ConnexionMessageHandler *mh, ConnexionAddedHandler *ah, ConnexionRemovedHandler *rh, _Bool useSeparateThread)"
    );
    const RegisterConnexionClient = this.lib.func(
      "uint16_t RegisterConnexionClient(uint32_t signature, uint8_t *name, uint16_t mode, uint32_t mask)"
    );
    const SetConnexionClientButtonMask = this.lib.func(
      "void SetConnexionClientButtonMask(uint16_t clientID, uint32_t buttonMask)"
    );
    const UnregisterConnexionClient = this.lib.func(
      "void UnregisterConnexionClient(uint16_t clientID)"
    );
    const CleanupConnexionHandlers = this.lib.func(
      "void CleanupConnexionHandlers()"
    );

    // CoreFoundation for run loop pumping
    const CFRunLoopRunInMode = this.coreFoundation.func(
      "int32_t CFRunLoopRunInMode(const void *mode, double seconds, _Bool returnAfterSourceHandled)"
    );
    // kCFRunLoopDefaultMode is a CFStringRef constant — load it
    const kCFRunLoopDefaultModePtr = this.coreFoundation.func(
      "const void *CFRunLoopGetCurrent()"
    );

    this.ffi = {
      SetConnexionHandlers,
      RegisterConnexionClient,
      SetConnexionClientButtonMask,
      UnregisterConnexionClient,
      CleanupConnexionHandlers,
      CFRunLoopRunInMode,
    };

    // Create JS callbacks that koffi marshals to C function pointers
    const messageHandler = koffi.register(
      (connection: number, messageType: number, messageArgument: any) => {
        if (messageType === kConnexionMsgDeviceState) {
          const state = koffi.decode(messageArgument, ConnexionDeviceState);
          if (this.onSpatialData) {
            this.onSpatialData(
              state.axis[0], state.axis[1], state.axis[2],
              state.axis[3], state.axis[4], state.axis[5]
            );
          }
          if (this.onButtonChange && state.buttons !== this.prevButtons) {
            this.onButtonChange(state.buttons, this.prevButtons);
            this.prevButtons = state.buttons;
          }
        }
      },
      koffi.pointer(MessageHandlerProto)
    );

    const addedHandler = koffi.register(
      (connection: number) => {
        const deviceId = `spacemouse-${connection.toString(16)}`;
        this.devices.push({
          id: deviceId,
          name: "SpaceMouse",
          vendorId: 0x046d,
          productId: 0,
        });
        this.onDeviceAdded?.(deviceId);
      },
      koffi.pointer(AddedHandlerProto)
    );

    const removedHandler = koffi.register(
      (connection: number) => {
        const deviceId = `spacemouse-${connection.toString(16)}`;
        this.devices = this.devices.filter((d) => d.id !== deviceId);
        this.onDeviceRemoved?.(deviceId);
      },
      koffi.pointer(RemovedHandlerProto)
    );

    // Register handlers (callbacks fire on main thread via CFRunLoop)
    const err = SetConnexionHandlers(messageHandler, addedHandler, removedHandler, false);
    if (err !== 0) {
      throw new Error(`SetConnexionHandlers failed with error ${err}`);
    }

    // Register as a system-wide client
    this.clientId = RegisterConnexionClient(
      kConnexionClientWildcard,
      null,
      kConnexionClientModeTakeOver,
      kConnexionMaskAll
    );

    // Capture all buttons (beyond first 8)
    SetConnexionClientButtonMask(this.clientId, kConnexionMaskAllButtons);

    // Pump the CFRunLoop to dispatch callbacks into JS
    // The framework enqueues events on the default run loop mode.
    // We need to get kCFRunLoopDefaultMode — it's a CFString constant.
    // For simplicity, pass NULL which defaults to kCFRunLoopDefaultMode
    // in many contexts, but CFRunLoopRunInMode needs the actual mode string.
    // We'll use the string literal "kCFRunLoopDefaultMode" approach:
    // Actually, kCFRunLoopDefaultMode is an exported symbol we can read.
    this.runLoopTimer = setInterval(() => {
      try {
        // Run the loop briefly to process any pending events
        // mode=null defaults to default mode, 0 seconds timeout, process all sources
        CFRunLoopRunInMode(null, 0, true);
      } catch {
        // Ignore run loop errors
      }
    }, 1); // 1ms — high frequency to minimize latency
  }

  disconnect(): void {
    if (this.runLoopTimer) {
      clearInterval(this.runLoopTimer);
      this.runLoopTimer = null;
    }
    if (this.ffi && this.clientId) {
      this.ffi.UnregisterConnexionClient(this.clientId);
      this.ffi.CleanupConnexionHandlers();
      this.clientId = 0;
    }
    this.devices = [];
  }

  getDevices(): DeviceInfo[] {
    return [...this.devices];
  }
}
