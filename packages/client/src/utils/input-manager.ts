import { TypedEmitter } from "../core/emitter.js";
import type { SatMouseConnection } from "../core/connection.js";
import type { SpatialData, ButtonEvent, DeviceInfo, ConnectionState, TransportProtocol } from "../core/types.js";
import type { InputConfig } from "./config.js";
import { DEFAULT_CONFIG, mergeConfig } from "./config.js";
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

/**
 * Unified device service that wraps one or more SatMouseConnections
 * and provides a single processed event stream.
 *
 * Applies a configurable transform pipeline to spatial data:
 *   deadZone → dominant → flip → axisRemap → sensitivity → lock
 *
 * Persists settings to storage (localStorage by default).
 */
export class InputManager extends TypedEmitter<InputManagerEvents> {
  private connections: SatMouseConnection[] = [];
  private storage?: StorageAdapter;

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
    return results.flat();
  }

  /** Update configuration. Persists by default. */
  updateConfig(partial: Partial<InputConfig>, persist = true): void {
    this._config = mergeConfig(this._config, partial);
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
    connection.on("deviceStatus", (event, device) => this.emit("deviceStatus", event, device));
  }

  private processSpatialData(raw: SpatialData): SpatialData | null {
    const cfg = this._config;
    let data = raw;

    // Transform pipeline
    if (cfg.deadZone > 0) data = applyDeadZone(data, cfg.deadZone);
    if (cfg.dominant) data = applyDominant(data);
    data = applyFlip(data, cfg.flip);
    data = applyAxisRemap(data, cfg.axisRemap);
    data = applySensitivity(data, cfg.sensitivity);

    // Lock axes
    if (cfg.lockPosition) {
      data = { ...data, translation: { x: 0, y: 0, z: 0 } };
    }
    if (cfg.lockRotation) {
      data = { ...data, rotation: { x: 0, y: 0, z: 0 } };
    }

    return data;
  }
}
