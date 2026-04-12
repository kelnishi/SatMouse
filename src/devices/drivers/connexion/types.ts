import { EventEmitter } from "node:events";
import type { DeviceInfo } from "../../types.js";

/** Raw event from the 3Dconnexion framework callback */
export interface ConnexionRawEvent {
  command: number;
  axes: [number, number, number, number, number, number];
  buttons: number;
  productId: number;
}

export interface ConnexionDriverEvents {
  rawEvent: [event: ConnexionRawEvent];
  deviceAdded: [productId: number, deviceId: string];
  deviceRemoved: [deviceId: string];
}

/** Platform-specific 3Dconnexion driver interface */
export abstract class ConnexionDriver extends EventEmitter<ConnexionDriverEvents> {
  abstract probe(): boolean;
  abstract connect(): Promise<void>;
  abstract disconnect(): void;
  abstract getDevices(): DeviceInfo[];

  /** Track whether connect() has been called */
  protected _connected = false;
  get connected(): boolean { return this._connected; }
}
