export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 6DOF spatial input frame — matches spatial-data.schema.json */
export interface SpatialData {
  translation: Vec3;
  rotation: Vec3;
  timestamp: number;
}

/** Button press/release event — matches button-event.schema.json */
export interface ButtonEvent {
  button: number;
  pressed: boolean;
  timestamp: number;
}

/** Device metadata from the bridge */
export interface DeviceInfo {
  id: string;
  name: string;
  vendorId?: number;
  productId?: number;
  connected?: boolean;
}

export type ConnectionState = "disconnected" | "connecting" | "connected";
export type TransportProtocol = "webtransport" | "websocket" | "none";

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
  /** WebSocket subprotocol. Default: "satmouse-json" */
  wsSubprotocol?: "satmouse-json" | "satmouse-binary";
}
