import { TypedEmitter } from "./emitter.js";
import { fetchThingDescription, resolveEndpoints } from "./discovery.js";
import { WebTransportAdapter } from "./transports/webtransport.js";
import { WebSocketAdapter } from "./transports/websocket.js";
import type { Transport } from "./transports/transport.js";
import type {
  ConnectOptions,
  ConnectionState,
  DeviceInfo,
  SatMouseEvents,
  TransportProtocol,
} from "./types.js";

const DEFAULT_OPTIONS: Required<
  Pick<ConnectOptions, "transports" | "reconnectDelay" | "wsSubprotocol">
> = {
  transports: ["webtransport", "websocket"],
  reconnectDelay: 2000,
  wsSubprotocol: "satmouse-json",
};

/**
 * Core connection to a SatMouse bridge.
 *
 * Handles discovery (via WoT Thing Description), transport negotiation
 * (WebTransport with WebSocket fallback), event dispatch, and auto-reconnect.
 */
export class SatMouseConnection extends TypedEmitter<SatMouseEvents> {
  private options: ConnectOptions & typeof DEFAULT_OPTIONS;
  private transport: Transport | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private deviceInfoUrl: string | null = null;

  private _state: ConnectionState = "disconnected";
  private _protocol: TransportProtocol = "none";

  get state(): ConnectionState {
    return this._state;
  }
  get protocol(): TransportProtocol {
    return this._protocol;
  }

  constructor(options?: ConnectOptions) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async connect(): Promise<void> {
    this.intentionalClose = false;
    this.setState("connecting", "none");

    // Resolve endpoints
    let wtUrl = this.options.wtUrl;
    let wsUrl = this.options.wsUrl;
    let certHash = this.options.certHash;

    if (!wtUrl && !wsUrl) {
      const tdUrl =
        this.options.tdUrl ??
        new URL("/td.json", globalThis.location?.origin ?? "http://localhost:4444").href;

      try {
        const td = await fetchThingDescription(tdUrl);
        const endpoints = resolveEndpoints(td);
        wtUrl = endpoints.webtransport?.url;
        wsUrl = endpoints.websocket?.url;
        certHash = certHash ?? endpoints.webtransport?.certHash;
        this.deviceInfoUrl = endpoints.deviceInfoUrl ?? null;
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
        // Fall back to default WS URL
        wsUrl = `ws://${globalThis.location?.hostname ?? "localhost"}:${globalThis.location?.port ?? "4444"}/spatial`;
      }
    }

    // Try transports in preference order
    for (const proto of this.options.transports) {
      if (proto === "webtransport" && wtUrl) {
        try {
          if (typeof globalThis.WebTransport === "undefined") continue;
          const adapter = new WebTransportAdapter(wtUrl, certHash);
          if (await this.tryTransport(adapter)) return;
        } catch {
          continue;
        }
      }
      if (proto === "websocket" && wsUrl) {
        try {
          const adapter = new WebSocketAdapter(wsUrl, this.options.wsSubprotocol);
          if (await this.tryTransport(adapter)) return;
        } catch {
          continue;
        }
      }
    }

    this.setState("disconnected", "none");
    this.scheduleReconnect();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnect();
    this.transport?.close();
    this.transport = null;
    this.setState("disconnected", "none");
  }

  async fetchDeviceInfo(): Promise<DeviceInfo[]> {
    if (!this.deviceInfoUrl) return [];
    const res = await globalThis.fetch(this.deviceInfoUrl);
    if (!res.ok) return [];
    const data = await res.json();
    return data.devices ?? [];
  }

  private async tryTransport(adapter: Transport): Promise<boolean> {
    adapter.onSpatialData = (data) => this.emit("spatialData", data);
    adapter.onButtonEvent = (data) => this.emit("buttonEvent", data);
    adapter.onError = (err) => this.emit("error", err);

    if ("onDeviceStatus" in adapter) {
      (adapter as any).onDeviceStatus = (event: "connected" | "disconnected", device: DeviceInfo) => {
        this.emit("deviceStatus", event, device);
      };
    }

    adapter.onClose = () => {
      this.transport = null;
      this.setState("disconnected", "none");
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    try {
      await adapter.connect();
      this.transport = adapter;
      this.setState("connected", adapter.protocol);
      return true;
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  private setState(state: ConnectionState, protocol: TransportProtocol): void {
    if (this._state === state && this._protocol === protocol) return;
    this._state = state;
    this._protocol = protocol;
    this.emit("stateChange", state, protocol);
  }

  private scheduleReconnect(): void {
    if (this.options.reconnectDelay <= 0 || this.intentionalClose) return;
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.options.reconnectDelay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
