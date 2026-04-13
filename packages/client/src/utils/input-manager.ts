import { TypedEmitter } from "../core/emitter.js";
import type { SatMouseConnection } from "../core/connection.js";
import type { SpatialData, ButtonEvent, DeviceInfo, ConnectionState, TransportProtocol } from "../core/types.js";
import type { InputConfig, DeviceConfig } from "./config.js";
import { DEFAULT_CONFIG, mergeConfig, resolveDeviceConfig } from "./config.js";
import { loadSettings, saveSettings, clearSettings, type StorageAdapter } from "./persistence.js";
import { applyRoutes, buildRoutes, DEFAULT_ROUTES, type AxisRoute } from "./action-map.js";

export interface InputManagerEvents {
  spatialData: (data: SpatialData) => void;
  rawSpatialData: (data: SpatialData) => void;
  buttonEvent: (data: ButtonEvent) => void;
  stateChange: (state: ConnectionState, protocol: TransportProtocol) => void;
  deviceStatus: (event: "connected" | "disconnected", device: DeviceInfo) => void;
  configChange: (config: InputConfig) => void;
}

export interface DeviceWithConfig {
  device: DeviceInfo;
  config: DeviceConfig;
}

export class InputManager extends TypedEmitter<InputManagerEvents> {
  private connections: SatMouseConnection[] = [];
  private storage?: StorageAdapter;
  private knownDevices = new Map<string, DeviceInfo>();

  private deviceAccumulators = new Map<string, { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number; w: number }>();
  private accDirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  private _config: InputConfig;
  private _state: ConnectionState = "disconnected";
  private _protocol: TransportProtocol = "none";

  get config(): InputConfig {
    return this._config;
  }

  get state(): ConnectionState {
    return this._state;
  }

  get protocol(): TransportProtocol {
    return this._protocol;
  }

  constructor(config?: Partial<InputConfig>, storage?: StorageAdapter) {
    super();
    this.storage = storage;
    const persisted = loadSettings(storage);
    this._config = mergeConfig(DEFAULT_CONFIG, { ...config, ...persisted });
    this.flushTimer = setInterval(() => this.flushAccumulator(), 16);
  }

  addConnection(connection: SatMouseConnection): void {
    this.connections.push(connection);
    this.wireConnection(connection);
  }

  /** Reset retry count and reconnect all failed connections. */
  retry(): void {
    for (const c of this.connections) c.retry();
  }

  removeConnection(connection: SatMouseConnection): void {
    const idx = this.connections.indexOf(connection);
    if (idx !== -1) this.connections.splice(idx, 1);
    connection.removeAllListeners();
  }

  async connect(): Promise<void> {
    await Promise.all(this.connections.map((c) => c.connect()));
  }

  disconnect(): void {
    for (const c of this.connections) c.disconnect();
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
  }

  async fetchDeviceInfo(): Promise<DeviceInfo[]> {
    const results = await Promise.all(this.connections.map((c) => c.fetchDeviceInfo()));
    const devices = results.flat();
    for (const d of devices) this.knownDevices.set(d.id, d);
    return devices;
  }

  getDevicesWithConfig(): DeviceWithConfig[] {
    return Array.from(this.knownDevices.values()).map((device) => ({
      device,
      config: this.getDeviceConfig(device.id),
    }));
  }

  getDeviceConfig(deviceId: string): DeviceConfig {
    const resolved = resolveDeviceConfig(this._config, deviceId);
    return {
      routes: resolved.routes,
      buttonRoutes: resolved.buttonRoutes,
      translateScale: resolved.translateScale,
      rotateScale: resolved.rotateScale,
      wScale: resolved.wScale,
      deadZone: resolved.deadZone,
      dominant: resolved.dominant,
    };
  }

  updateConfig(partial: Partial<InputConfig>, persist = true): void {
    this._config = mergeConfig(this._config, partial);
    if (persist) saveSettings(this._config, this.storage);
    this.emit("configChange", this._config);
  }

  updateDeviceConfig(deviceId: string, partial: DeviceConfig, persist = true): void {
    const existing = this._config.devices[deviceId] ?? {};
    this._config = mergeConfig(this._config, {
      devices: { [deviceId]: { ...existing, ...partial } },
    });
    if (persist) saveSettings(this._config, this.storage);
    this.emit("configChange", this._config);
  }

  resetDeviceConfig(deviceId: string, persist = true): void {
    const { [deviceId]: _, ...rest } = this._config.devices;
    this._config = { ...this._config, devices: rest };
    if (persist) saveSettings(this._config, this.storage);
    this.emit("configChange", this._config);
  }

  resetAllConfig(): void {
    clearSettings(this.storage);
    this._config = { ...DEFAULT_CONFIG };
    this.emit("configChange", this._config);
  }

  onSpatialData(callback: (data: SpatialData) => void): () => void {
    this.on("spatialData", callback);
    return () => this.off("spatialData", callback);
  }

  onButtonEvent(callback: (data: ButtonEvent) => void): () => void {
    this.on("buttonEvent", callback);
    return () => this.off("buttonEvent", callback);
  }

  private wireConnection(connection: SatMouseConnection): void {
    connection.on("spatialData", (raw) => {
      this.emit("rawSpatialData", raw);

      const id = raw.deviceId ?? "_default";
      const processed = this.processPerDevice(raw, id);

      this.deviceAccumulators.set(id, {
        tx: processed.translation.x,
        ty: processed.translation.y,
        tz: processed.translation.z,
        rx: processed.rotation.x,
        ry: processed.rotation.y,
        rz: processed.rotation.z,
        w: processed.w ?? 0,
      });
      this.accDirty = true;
    });

    connection.on("buttonEvent", (event) => {
      // Check all device configs for matching button routes
      this.dispatchButtonKeys(event);
      this.emit("buttonEvent", event);
    });
    connection.on("stateChange", (state, proto) => {
      this._state = state;
      this._protocol = proto;
      this.emit("stateChange", state, proto);
    });
    connection.on("deviceStatus", (event, device) => {
      if (event === "connected") this.knownDevices.set(device.id, device);
      else this.knownDevices.delete(device.id);
      this.emit("deviceStatus", event, device);
    });
  }

  private flushAccumulator(): void {
    if (!this.accDirty) return;

    const merged = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, w: 0 };
    for (const acc of this.deviceAccumulators.values()) {
      merged.tx += acc.tx;
      merged.ty += acc.ty;
      merged.tz += acc.tz;
      merged.rx += acc.rx;
      merged.ry += acc.ry;
      merged.rz += acc.rz;
      merged.w += acc.w;
    }

    this.deviceAccumulators.clear();
    this.accDirty = false;

    let data: SpatialData = {
      translation: { x: merged.tx, y: merged.ty, z: merged.tz },
      rotation: { x: merged.rx, y: merged.ry, z: merged.rz },
      w: merged.w || undefined,
      timestamp: performance.now() * 1000,
    };

    if (this._config.lockPosition) {
      data = { ...data, translation: { x: 0, y: 0, z: 0 } };
    }
    if (this._config.lockRotation) {
      data = { ...data, rotation: { x: 0, y: 0, z: 0 } };
    }

    this.emit("spatialData", data);
  }

  /** Per-device: deadZone → dominant → routes (flip + scale + remap in one pass) */
  private processPerDevice(raw: SpatialData, deviceId: string): SpatialData {
    const cfg = resolveDeviceConfig(this._config, deviceId);
    let data = raw;

    // Dead zone
    if (cfg.deadZone > 0) {
      const dz = (v: number) => (Math.abs(v) < cfg.deadZone ? 0 : v);
      data = {
        ...data,
        translation: { x: dz(data.translation.x), y: dz(data.translation.y), z: dz(data.translation.z) },
        rotation: { x: dz(data.rotation.x), y: dz(data.rotation.y), z: dz(data.rotation.z) },
      };
    }

    // Dominant axis
    if (cfg.dominant) {
      const axes = [
        { g: "t" as const, k: "x" as const, v: Math.abs(data.translation.x) },
        { g: "t" as const, k: "y" as const, v: Math.abs(data.translation.y) },
        { g: "t" as const, k: "z" as const, v: Math.abs(data.translation.z) },
        { g: "r" as const, k: "x" as const, v: Math.abs(data.rotation.x) },
        { g: "r" as const, k: "y" as const, v: Math.abs(data.rotation.y) },
        { g: "r" as const, k: "z" as const, v: Math.abs(data.rotation.z) },
      ];
      const max = axes.reduce((a, b) => (b.v > a.v ? b : a));
      const t = { x: 0, y: 0, z: 0 };
      const r = { x: 0, y: 0, z: 0 };
      if (max.g === "t") t[max.k] = data.translation[max.k];
      else r[max.k] = data.rotation[max.k];
      data = { ...data, translation: t, rotation: r };
    }

    // Routes: flip + scale + remap in one pass
    // Use device-specific routes if configured, otherwise build from device axes metadata
    const device = this.knownDevices.get(deviceId);
    const deviceRoutes = this.resolveRoutes(deviceId, device);
    data = applyRoutes(data, deviceRoutes, cfg.translateScale, cfg.rotateScale, cfg.wScale);

    return data;
  }

  /** Get the effective routes for a device: device config override > device axes metadata > global default */
  private resolveRoutes(deviceId: string, device?: DeviceInfo): AxisRoute[] {
    // Check for explicit device config (exact match or pattern)
    const devCfg = this._config.devices[deviceId];
    if (devCfg?.routes && Array.isArray(devCfg.routes)) return devCfg.routes;

    // Check pattern matches
    for (const [pattern, cfg] of Object.entries(this._config.devices)) {
      if (pattern.endsWith("*") && deviceId.startsWith(pattern.slice(0, -1))) {
        if (cfg.routes && Array.isArray(cfg.routes)) return cfg.routes;
      }
    }

    // Build from device axes metadata
    if (device?.axes) return buildRoutes(device.axes);

    // Global fallback
    return DEFAULT_ROUTES;
  }

  /** Dispatch KeyboardEvents for button routes matching this button event */
  private dispatchButtonKeys(event: ButtonEvent): void {
    if (typeof document === "undefined") return;

    // Collect all button routes from all device configs + global
    const allRoutes = this.collectButtonRoutes();
    for (const route of allRoutes) {
      if (route.button === event.button) {
        document.dispatchEvent(new KeyboardEvent(
          event.pressed ? "keydown" : "keyup",
          { key: route.key, code: route.code ?? "", bubbles: true },
        ));
      }
    }
  }

  /** Gather all button routes from global config + all device configs */
  private collectButtonRoutes(): import("./config.js").ButtonRoute[] {
    const routes = [...this._config.buttonRoutes];
    for (const devCfg of Object.values(this._config.devices)) {
      if (devCfg.buttonRoutes) routes.push(...devCfg.buttonRoutes);
    }
    return routes;
  }
}
