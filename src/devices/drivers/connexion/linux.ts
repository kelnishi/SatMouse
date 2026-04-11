import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { DeviceInfo } from "../../types.js";
import type { ConnexionDriver, ConnexionRawEvent } from "./types.js";
import { buildDeviceInfo } from "./products.js";

const require = createRequire(import.meta.url);

const LIBSPNAV_PATHS = [
  "/usr/lib/libspnav.so",
  "/usr/lib/x86_64-linux-gnu/libspnav.so",
  "/usr/lib/aarch64-linux-gnu/libspnav.so",
  "/usr/local/lib/libspnav.so",
];

// spnav_event type constants
const SPNAV_EVENT_MOTION = 1;
const SPNAV_EVENT_BUTTON = 2;

/**
 * Linux driver for 3Dconnexion devices via libspnav.
 *
 * libspnav provides a simple C API:
 *   spnav_open() / spnav_close()
 *   spnav_poll_event(spnav_event *event) — returns event type
 *   spnav_event is a union with motion (x,y,z,rx,ry,rz) and button (press,bnum)
 */
export class LinuxConnexionDriver implements ConnexionDriver {
  onRawEvent: ConnexionDriver["onRawEvent"] = null;
  onDeviceAdded: ConnexionDriver["onDeviceAdded"] = null;
  onDeviceRemoved: ConnexionDriver["onDeviceRemoved"] = null;

  private devices: DeviceInfo[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lib: any = null;

  probe(): boolean {
    return LIBSPNAV_PATHS.some((p) => existsSync(p));
  }

  async connect(): Promise<void> {
    const koffi: any = require("koffi");

    const libPath = LIBSPNAV_PATHS.find((p) => existsSync(p));
    if (!libPath) throw new Error("libspnav not found");

    this.lib = koffi.load(libPath);

    // libspnav API
    const spnav_open = this.lib.func("int spnav_open()");
    const spnav_close = this.lib.func("int spnav_close()");
    const spnav_poll_event = this.lib.func("int spnav_poll_event(void *event)");

    const result = spnav_open();
    if (result !== 0) throw new Error(`spnav_open failed: ${result}`);

    console.log("[3Dconnexion/Linux] Connected via libspnav");

    // Announce device (libspnav doesn't have device enumeration)
    const deviceId = "cnx-spnav-0";
    const info = buildDeviceInfo(0, deviceId);
    info.name = "SpaceMouse (spnav)";
    info.model = "SpaceMouse (spnav)";
    this.devices = [info];
    this.onDeviceAdded?.(0, deviceId);

    // spnav_event layout:
    //   int type;                    // offset 0, 4 bytes
    //   union {
    //     struct { int x, y, z, rx, ry, rz; int period; };  // motion (offset 4, 7 ints)
    //     struct { int press; int bnum; };                    // button (offset 4, 2 ints)
    //   };
    const EVENT_SIZE = 64; // generous buffer
    let prevButtons = 0;

    this.pollTimer = setInterval(() => {
      const eventBuf = Buffer.alloc(EVENT_SIZE);
      const eventType = spnav_poll_event(eventBuf);
      if (eventType === 0) return; // no event

      const type = eventBuf.readInt32LE(0);

      if (type === SPNAV_EVENT_MOTION) {
        const event: ConnexionRawEvent = {
          command: 3,
          axes: [
            eventBuf.readInt32LE(4),   // x
            eventBuf.readInt32LE(8),   // y
            eventBuf.readInt32LE(12),  // z
            eventBuf.readInt32LE(16),  // rx
            eventBuf.readInt32LE(20),  // ry
            eventBuf.readInt32LE(24),  // rz
          ],
          buttons: prevButtons,
          productId: 0,
        };
        this.onRawEvent?.(event);
      } else if (type === SPNAV_EVENT_BUTTON) {
        const press = eventBuf.readInt32LE(4);
        const bnum = eventBuf.readInt32LE(8);
        if (press) {
          prevButtons |= (1 << bnum);
        } else {
          prevButtons &= ~(1 << bnum);
        }
        const event: ConnexionRawEvent = {
          command: 2,
          axes: [0, 0, 0, 0, 0, 0],
          buttons: prevButtons,
          productId: 0,
        };
        this.onRawEvent?.(event);
      }
    }, 4);
  }

  disconnect(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.lib) {
      try { this.lib.func("int spnav_close()")(); } catch {}
    }
    this.devices = [];
  }

  getDevices(): DeviceInfo[] {
    return [...this.devices];
  }
}
