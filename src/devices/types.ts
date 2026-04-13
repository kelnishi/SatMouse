import { EventEmitter } from "node:events";

/** 6DOF spatial input frame — matches spatial-data.schema.json */
export interface SpatialData {
  translation: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  timestamp: number;
  /** Source device ID (e.g., "cnx-c635", "hid-054c-5c4") */
  deviceId?: string;
}

/** Button press/release event — matches button-event.schema.json */
export interface ButtonEvent {
  button: number;
  pressed: boolean;
  timestamp: number;
}

/** Device form factor */
export type DeviceClass = "spacemouse" | "gamepad" | "dial" | "joystick" | "6dof" | "other";

/** Static metadata about a connected device */
export interface DeviceInfo {
  id: string;
  name: string;
  model: string;
  vendor: string;
  vendorId: number;
  productId: number;
  connectionType: "usb" | "wireless" | "bluetooth" | "unknown";
  /** General form factor */
  deviceClass?: DeviceClass;
  /** Axes this device provides (e.g., ["tx","ty","tz","rx","ry","rz"] or ["tx","ty","rx","ry","tz+","rz+"]) */
  axes?: string[];
  /** Human-readable labels for axes (same order as axes array) */
  axisLabels?: string[];
  /** Number of buttons this device provides */
  buttonCount?: number;
  /** Human-readable labels for buttons (indexed by targetButton) */
  buttonLabels?: string[];
}

/** Events emitted by a DevicePlugin */
export interface DevicePluginEvents {
  spatialData: [data: SpatialData];
  buttonEvent: [data: ButtonEvent];
  deviceConnected: [info: DeviceInfo];
  deviceDisconnected: [info: DeviceInfo];
  error: [error: Error];
}

/**
 * Contract for device plugins. Each plugin bridges a family of hardware
 * devices (e.g., 3DConnexion SpaceMouse, Orbion, generic HID) into the
 * SatMouse event system.
 *
 * Implementations live in src/devices/plugins/<name>/
 */
export abstract class DevicePlugin extends EventEmitter<DevicePluginEvents> {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly supportedPlatforms: NodeJS.Platform[];

  /** Whether this plugin supports disconnect+reconnect for device re-enumeration.
   *  Plugins backed by singleton drivers (e.g. 3Dconnexion) should leave this false. */
  readonly supportsRescan: boolean = false;

  /** Probe whether the hardware SDK/library is available on this machine */
  abstract isAvailable(): Promise<boolean>;

  /** Connect to all discoverable devices of this type */
  abstract connect(): Promise<void>;

  /** Disconnect all devices and release resources */
  abstract disconnect(): void;

  /** List currently connected devices */
  abstract getDevices(): DeviceInfo[];
}
