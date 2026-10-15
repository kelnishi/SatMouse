import type { SpatialData, ButtonEvent, TransportProtocol } from "../types.js";

export interface Transport {
  readonly protocol: TransportProtocol;
  connect(): Promise<void>;
  close(): void;
  onSpatialData: ((data: SpatialData) => void) | null;
  onButtonEvent: ((data: ButtonEvent) => void) | null;
  onClose: (() => void) | null;
  onError: ((error: Error) => void) | null;
  /** Report page focus to the bridge (see docs/protocol.md) */
  sendFocus(focused: boolean): void;
}
