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
import { applyActionMap, actionValuesToSpatialData, type ActionValues } from "./action-map.js";

export interface InputManagerEvents {
  /** Processed spatial data (after all transforms + action map) */
  spatialData: (data: SpatialData) => void;
  /** Named action values from the action map */
  actionValues: (values: ActionValues) => void;
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

  // Per-device accumulators: latest value from each device per frame tick
  private deviceAccumulators = new Map<string, { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number }>();
  private accDirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  private _config: InputConfig;

  get config(): InputConfig {
    return this._config;
  }

  constructor(config?: Partial<InputConfig>, storage?: StorageAdapter) {
    super();
    this.storage = storage;
    const persisted = loadSettings(storage);
    this._config = mergeConfig(DEFAULT_CONFIG, { ...config, ...persisted });

    // Flush accumulated inputs at ~60Hz
    this.flushTimer = setInterval(() => this.flushAccumulator(), 16);
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
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
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
      actionMap: resolved.actionMap,
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

  /** Register a callback for action values. Returns unsubscribe function. */
  onActionValues(callback: (values: ActionValues) => void): () => void {
    this.on("actionValues", callback);
    return () => this.off("actionValues", callback);
  }

  private wireConnection(connection: SatMouseConnection): void {
    connection.on("spatialData", (raw) => {
      this.emit("rawSpatialData", raw);

      const id = raw.deviceId ?? "_default";

      // Apply per-device transforms BEFORE accumulating
      const processed = this.processPerDevice(raw, id);

      // Store latest per-device processed values
      this.deviceAccumulators.set(id, {
        tx: processed.translation.x,
        ty: processed.translation.y,
        tz: processed.translation.z,
        rx: processed.rotation.x,
        ry: processed.rotation.y,
        rz: processed.rotation.z,
      });
      this.accDirty = true;
    });

    connection.on("buttonEvent", (event) => this.emit("buttonEvent", event));
    connection.on("stateChange", (state, proto) => this.emit("stateChange", state, proto));
    connection.on("deviceStatus", (event, device) => {
      if (event === "connected") this.knownDevices.set(device.id, device);
      else this.knownDevices.delete(device.id);
      this.emit("deviceStatus", event, device);
    });
  }

  private flushAccumulator(): void {
    if (!this.accDirty) return;

    // Merge all device accumulators: sum contributions from each device
    const merged = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
    for (const acc of this.deviceAccumulators.values()) {
      merged.tx += acc.tx;
      merged.ty += acc.ty;
      merged.tz += acc.tz;
      merged.rx += acc.rx;
      merged.ry += acc.ry;
      merged.rz += acc.rz;
    }

    // Reset all device accumulators
    this.deviceAccumulators.clear();
    this.accDirty = false;

    const data: SpatialData = {
      translation: { x: merged.tx, y: merged.ty, z: merged.tz },
      rotation: { x: merged.rx, y: merged.ry, z: merged.rz },
      timestamp: performance.now() * 1000,
    };

    // Apply global transforms (action map, locks)
    const { spatial, actions } = this.applyGlobalTransforms(data);
    if (spatial) this.emit("spatialData", spatial);
    if (actions) this.emit("actionValues", actions);
  }

  /** Per-device transforms: flip, sensitivity, dead zone, dominant, axis remap */
  private processPerDevice(raw: SpatialData, deviceId: string): SpatialData {
    const cfg = resolveDeviceConfig(this._config, deviceId);
    let data = raw;

    if (cfg.deadZone > 0) data = applyDeadZone(data, cfg.deadZone);
    if (cfg.dominant) data = applyDominant(data);
    data = applyFlip(data, cfg.flip);
    data = applyAxisRemap(data, cfg.axisRemap);
    data = applySensitivity(data, cfg.sensitivity);

    return data;
  }

  /** Global transforms applied after per-device merge: locks + action map */
  private applyGlobalTransforms(data: SpatialData): { spatial: SpatialData | null; actions: ActionValues | null } {
    const cfg = this._config;

    if (cfg.lockPosition) {
      data = { ...data, translation: { x: 0, y: 0, z: 0 } };
    }
    if (cfg.lockRotation) {
      data = { ...data, rotation: { x: 0, y: 0, z: 0 } };
    }

    const actions = applyActionMap(data, cfg.actionMap);
    const spatial = actionValuesToSpatialData(actions, data.timestamp);

    return { spatial, actions };
  }
}
