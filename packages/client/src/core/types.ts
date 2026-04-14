export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 6DOF+W spatial input frame */
export interface SpatialData {
  translation: Vec3;
  rotation: Vec3;
  /** Virtual W axis — application-defined (e.g., zoom, scroll, tool size) */
  w?: number;
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

/** Device metadata from the bridge */
export interface DeviceInfo {
  id: string;
  name: string;
  model?: string;
  vendor?: string;
  vendorId?: number;
  productId?: number;
  connectionType?: "usb" | "wireless" | "bluetooth" | "unknown";
  /** General form factor */
  deviceClass?: DeviceClass;
  connected?: boolean;
  /** Axes this device provides (e.g., ["tx","ty","tz","rx","ry","rz"] or ["tx","ty","rx","ry","tz+","rz+"]) */
  axes?: string[];
  /** Human-readable labels for axes (same order as axes array) */
  axisLabels?: string[];
  /** Number of buttons this device provides */
  buttonCount?: number;
  /** Human-readable labels for buttons (indexed by targetButton) */
  buttonLabels?: string[];
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "failed";
export type TransportProtocol = "webtransport" | "extension" | "websocket" | "none";

export interface SatMouseEvents {
  spatialData: (data: SpatialData) => void;
  buttonEvent: (data: ButtonEvent) => void;
  stateChange: (state: ConnectionState, protocol: TransportProtocol) => void;
  deviceStatus: (event: "connected" | "disconnected", device: DeviceInfo) => void;
  error: (error: Error) => void;
}

export interface ThingDescription {
  title: string;
  id: string;
  base?: string;
  version?: { instance: string };
  "satmouse:certHash"?: string;
  properties?: {
    deviceInfo?: { forms: Array<{ href: string; op: string }> };
  };
  events?: {
    spatialData?: {
      forms: Array<{ href: string; subprotocol: string; contentType: string }>;
    };
    buttonEvent?: {
      forms: Array<{ href: string; subprotocol: string; contentType: string }>;
    };
  };
}

export interface ConnectOptions {
  /**
   * SatMouse URI: satmouse://connect?host=<ip>&wsPort=<port>&wtPort=<port>
   * When provided, host/ports are extracted and used for discovery + transport.
   * All params are optional — defaults to localhost:4444/4443.
   */
  uri?: string;
  /** URL to td.json. Defaults to /td.json relative to window.location */
  tdUrl?: string;
  /** Direct WebSocket URL (skips discovery) */
  wsUrl?: string;
  /** Direct WebTransport URL (skips discovery) */
  wtUrl?: string;
  /** Certificate hash for self-signed WebTransport certs (base64) */
  certHash?: string;
  /** Preferred transport order. Default: ["webtransport", "websocket"] */
  transports?: TransportProtocol[];
  /** Auto-reconnect delay in ms. 0 to disable. Default: 2000 */
  reconnectDelay?: number;
  /** Max reconnect attempts before giving up. Default: 3 */
  maxRetries?: number;
  /** WebSocket subprotocol. Default: "satmouse-json" */
  wsSubprotocol?: "satmouse-json" | "satmouse-binary";
}
