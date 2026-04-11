import type { DeviceInfo } from "../../types.js";

/** Raw event from the 3Dconnexion framework callback */
export interface ConnexionRawEvent {
  command: number;
  axes: [number, number, number, number, number, number];
  buttons: number;
  productId: number;
}

/** Callbacks from the native 3Dconnexion driver */
export interface ConnexionCallbacks {
  onRawEvent: ((event: ConnexionRawEvent) => void) | null;
  onDeviceAdded: ((productId: number, deviceId: string) => void) | null;
  onDeviceRemoved: ((deviceId: string) => void) | null;
}

/** Platform-specific 3Dconnexion driver interface */
export interface ConnexionDriver extends ConnexionCallbacks {
  probe(): boolean;
  connect(): Promise<void>;
  disconnect(): void;
  getDevices(): DeviceInfo[];
}
