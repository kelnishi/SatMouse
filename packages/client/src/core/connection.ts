import { TypedEmitter } from "./emitter.js";
import { fetchThingDescription, resolveEndpoints } from "./discovery.js";
import { WebTransportAdapter } from "./transports/webtransport.js";
import { WebSocketAdapter } from "./transports/websocket.js";
import { WebRTCAdapter } from "./transports/webrtc.js";
import type { Transport } from "./transports/transport.js";
import type {
  ConnectOptions,
  ConnectionState,
  DeviceInfo,
  SatMouseEvents,
  TransportProtocol,
} from "./types.js";

/**
 * Build a satmouse:// connect URI from connection parameters.
 */
export function buildSatMouseUri(host = "localhost", wsPort = 18945, wtPort = 18946): string {
  return `satmouse://connect?host=${encodeURIComponent(host)}&wsPort=${wsPort}&wtPort=${wtPort}`;
}

/**
 * Parse a satmouse:// URI into connection parameters.
 *
 * Format: satmouse://connect?host=<ip>&wsPort=<port>&wtPort=<port>
 * All query params are optional. Defaults: host=localhost, wsPort=4444, wtPort=4443.
 */
export function parseSatMouseUri(uri: string): { tdUrl: string; wsUrl: string; wtUrl: string } {
  const url = new URL(uri);
  const host = url.searchParams.get("host") ?? "localhost";
  const wsPort = url.searchParams.get("wsPort") ?? "18945";
  const wtPort = url.searchParams.get("wtPort") ?? "18946";
  return {
    tdUrl: `http://${host}:${wsPort}/td.json`,
    wsUrl: `ws://${host}:${wsPort}/spatial`,
    wtUrl: `https://${host}:${wtPort}`,
  };
}

const DEFAULT_OPTIONS: Required<
  Pick<ConnectOptions, "transports" | "reconnectDelay" | "maxRetries" | "wsSubprotocol">
> = {
  transports: ["webtransport", "webrtc", "websocket"],
  reconnectDelay: 2000,
  maxRetries: 3,
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
  private retryCount = 0;

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

    // Resolve endpoints — satmouse:// URI takes priority
    let wtUrl = this.options.wtUrl;
    let wsUrl = this.options.wsUrl;
    let certHash = this.options.certHash;

    if (this.options.uri) {
      const parsed = parseSatMouseUri(this.options.uri);
      wtUrl = wtUrl ?? parsed.wtUrl;
      wsUrl = wsUrl ?? parsed.wsUrl;
      this.options.tdUrl = this.options.tdUrl ?? parsed.tdUrl;
    }

    if (!wtUrl && !wsUrl) {
      const tdUrl = this.options.tdUrl;
      // Use 127.0.0.1 (not localhost) — Safari treats the loopback IP as a
      // "Potentially Trustworthy Origin" more reliably than the hostname.
      // Try HTTPS first (works from HTTPS pages), fall back to HTTP.
      const tdUrls = tdUrl
        ? [tdUrl]
        : [
            "https://127.0.0.1:18947/td.json",
            "http://127.0.0.1:18945/td.json",
          ];

      let resolved = false;
      for (const url of tdUrls) {
        try {
          const td = await fetchThingDescription(url);
          const endpoints = resolveEndpoints(td);
          wtUrl = endpoints.webtransport?.url;
          wsUrl = endpoints.websocket?.url;
          certHash = certHash ?? endpoints.webtransport?.certHash;
          this.deviceInfoUrl = endpoints.deviceInfoUrl ?? null;
          resolved = true;
          break;
        } catch {
          // Try next URL
        }
      }
      if (!resolved) {
        this.emit("error", new Error("Failed to fetch Thing Description"));
        // On HTTPS pages, ws:// is blocked as mixed content.
        // Try wss:// on the HTTPS port; fall back to ws:// for HTTP pages.
        const isSecurePage = typeof globalThis.location !== "undefined" && globalThis.location.protocol === "https:";
        wsUrl = isSecurePage
          ? "wss://127.0.0.1:18947/spatial"
          : "ws://127.0.0.1:18945/spatial";
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
      if (proto === "webrtc") {
        try {
          if (typeof globalThis.RTCPeerConnection === "undefined") continue;
          // Use the rtcUrl option, or derive from wsUrl host
          const rtcUrl = this.options.rtcUrl ?? `http://127.0.0.1:18945/rtc/offer`;
          const adapter = new WebRTCAdapter(rtcUrl);
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

  /** Reset retry count and reconnect. Use after "failed" state. */
  retry(): void {
    this.retryCount = 0;
    this.intentionalClose = false;
    this.connect();
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
      this.retryCount = 0;
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

    this.retryCount++;
    console.log(`[SatMouse] Reconnect attempt ${this.retryCount}/${this.options.maxRetries}`);
    if (this.retryCount > this.options.maxRetries) {
      console.log("[SatMouse] Max retries exceeded, giving up");
      this.setState("failed", "none");
      return;
    }

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
