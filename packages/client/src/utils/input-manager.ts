import { TypedEmitter } from "../core/emitter.js";
import type { SatMouseConnection } from "../core/connection.js";
import type { SpatialData, ButtonEvent, DeviceInfo, ConnectionState, TransportProtocol } from "../core/types.js";
import type { InputConfig, DeviceConfig } from "./config.js";
import { DEFAULT_CONFIG, mergeConfig, resolveDeviceConfig } from "./config.js";
import { loadSettings, saveSettings, type StorageAdapter } from "./persistence.js";
import {
  applyFlip,
  applySensitivity,
  applyDominant,
  applyDeadZone,
  applyAxisRemap,
} from "./transforms.js";

export interface InputManagerEvents {
  /** Processed spatial data (after all transforms) */
  spatialData: (data: SpatialData) => void;
  /** Raw spatial data (before transforms) */
  rawSpatialData: (data: SpatialData) => void;
  /** Button event (pass-through from connection) */
  buttonEvent: (data: ButtonEvent) => void;
  /** Connection state changed */
  stateChange: (state: ConnectionState, protocol: TransportProtocol) => void;
  /** Device connected/disconnected */
  deviceStatus: (event: "connected" | "disconnected", device: DeviceInfo) => void;
  /** Configuration changed */
  configChange: (config: InputConfig) => void;
}

/** A connected device paired with its resolved configuration */
export interface DeviceWithConfig {
  device: DeviceInfo;
  config: DeviceConfig;
}

/**
 * Unified device service that wraps one or more SatMouseConnections
 * and provides a single processed event stream.
 *
 * Applies a configurable transform pipeline per-device:
 *   deadZone → dominant → flip → axisRemap → sensitivity → lock
 *
 * Per-device overrides are resolved from InputConfig.devices using
 * device ID matching (exact or pattern with wildcard "*").
 */
export class InputManager extends TypedEmitter<InputManagerEvents> {
  private connections: SatMouseConnection[] = [];
  private storage?: StorageAdapter;
  private knownDevices = new Map<string, DeviceInfo>();

  private _config: InputConfig;

  get config(): InputConfig {
    return this._config;
  }

  constructor(config?: Partial<InputConfig>, storage?: StorageAdapter) {
    super();
    this.storage = storage;
    const persisted = loadSettings(storage);
    this._config = mergeConfig(DEFAULT_CONFIG, { ...config, ...persisted });
  }

  /** Add a connection to the managed set */
  addConnection(connection: SatMouseConnection): void {
    this.connections.push(connection);
    this.wireConnection(connection);
  }

  /** Remove a connection */
  removeConnection(connection: SatMouseConnection): void {
    const idx = this.connections.indexOf(connection);
    if (idx !== -1) this.connections.splice(idx, 1);
    connection.removeAllListeners();
  }

  /** Connect all managed connections */
  async connect(): Promise<void> {
    await Promise.all(this.connections.map((c) => c.connect()));
  }

  /** Disconnect all managed connections */
  disconnect(): void {
    for (const c of this.connections) c.disconnect();
  }

  /** Fetch device info from all connections */
  async fetchDeviceInfo(): Promise<DeviceInfo[]> {
    const results = await Promise.all(this.connections.map((c) => c.fetchDeviceInfo()));
    const devices = results.flat();
    // Track known devices
    for (const d of devices) this.knownDevices.set(d.id, d);
    return devices;
  }

  /** Get all known connected devices paired with their resolved config */
  getDevicesWithConfig(): DeviceWithConfig[] {
    return Array.from(this.knownDevices.values()).map((device) => ({
      device,
      config: this.getDeviceConfig(device.id),
    }));
  }

  /** Get the resolved per-device config (global defaults + device overrides) */
  getDeviceConfig(deviceId: string): DeviceConfig {
    const resolved = resolveDeviceConfig(this._config, deviceId);
    return {
      sensitivity: resolved.sensitivity,
      flip: resolved.flip,
      deadZone: resolved.deadZone,
      dominant: resolved.dominant,
      axisRemap: resolved.axisRemap,
      lockPosition: resolved.lockPosition,
      lockRotation: resolved.lockRotation,
    };
  }

  /** Update global configuration. Persists by default. */
  updateConfig(partial: Partial<InputConfig>, persist = true): void {
    this._config = mergeConfig(this._config, partial);
    if (persist) saveSettings(this._config, this.storage);
    this.emit("configChange", this._config);
  }

  /** Update configuration for a specific device. Persists by default. */
  updateDeviceConfig(deviceId: string, partial: DeviceConfig, persist = true): void {
    const existing = this._config.devices[deviceId] ?? {};
    this._config = mergeConfig(this._config, {
      devices: { [deviceId]: { ...existing, ...partial } },
    });
    if (persist) saveSettings(this._config, this.storage);
    this.emit("configChange", this._config);
  }

  /** Register a callback for processed spatial data. Returns unsubscribe function. */
  onSpatialData(callback: (data: SpatialData) => void): () => void {
    this.on("spatialData", callback);
    return () => this.off("spatialData", callback);
  }

  /** Register a callback for button events. Returns unsubscribe function. */
  onButtonEvent(callback: (data: ButtonEvent) => void): () => void {
    this.on("buttonEvent", callback);
    return () => this.off("buttonEvent", callback);
  }

  private wireConnection(connection: SatMouseConnection): void {
    connection.on("spatialData", (raw) => {
      this.emit("rawSpatialData", raw);
      const processed = this.processSpatialData(raw);
      if (processed) this.emit("spatialData", processed);
    });

    connection.on("buttonEvent", (event) => this.emit("buttonEvent", event));
    connection.on("stateChange", (state, proto) => this.emit("stateChange", state, proto));
    connection.on("deviceStatus", (event, device) => {
      if (event === "connected") this.knownDevices.set(device.id, device);
      else this.knownDevices.delete(device.id);
      this.emit("deviceStatus", event, device);
    });
  }

  private processSpatialData(raw: SpatialData): SpatialData | null {
    // TODO: When the bridge includes deviceId in spatial data messages,
    // resolve per-device config here. For now, use global config.
    const cfg = this._config;
    let data = raw;

    // Transform pipeline
    if (cfg.deadZone > 0) data = applyDeadZone(data, cfg.deadZone);
    if (cfg.dominant) data = applyDominant(data);
    data = applyFlip(data, cfg.flip);
    data = applyAxisRemap(data, cfg.axisRemap);
    data = applySensitivity(data, cfg.sensitivity);

    if (cfg.lockPosition) {
      data = { ...data, translation: { x: 0, y: 0, z: 0 } };
    }
    if (cfg.lockRotation) {
      data = { ...data, rotation: { x: 0, y: 0, z: 0 } };
    }

    return data;
  }
}
