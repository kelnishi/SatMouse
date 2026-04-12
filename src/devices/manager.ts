import { EventEmitter } from "node:events";
import type { DevicePlugin, DevicePluginEvents, SpatialData, ButtonEvent, DeviceInfo } from "./types.js";

/** Events emitted by the DeviceManager (aggregate of all plugins) */
export interface DeviceManagerEvents extends DevicePluginEvents {}

/**
 * Manages device plugin lifecycle. Probes registered plugins for hardware
 * availability, connects those that are present, and aggregates their
 * events into a single stream for the transport layer.
 */
export class DeviceManager extends EventEmitter<DeviceManagerEvents> {
  private plugins = new Map<string, DevicePlugin>();
  private activePlugins = new Set<string>();

  registerPlugin(plugin: DevicePlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  async start(enabledIds?: string[]): Promise<void> {
    for (const [id, plugin] of this.plugins) {
      if (enabledIds?.length && !enabledIds.includes(id)) {
        continue;
      }

      if (!plugin.supportedPlatforms.includes(process.platform)) {
        console.log(`[DeviceManager] Skipping "${plugin.name}" (unsupported platform: ${process.platform})`);
        continue;
      }

      const available = await plugin.isAvailable();
      if (!available) {
        console.log(`[DeviceManager] Skipping "${plugin.name}" (SDK/library not found)`);
        continue;
      }

      this.wirePlugin(plugin);

      try {
        await plugin.connect();
        this.activePlugins.add(id);
        console.log(`[DeviceManager] Connected "${plugin.name}"`);
      } catch (err) {
        console.error(`[DeviceManager] Failed to connect "${plugin.name}":`, err);
      }
    }
  }

  stop(): void {
    for (const id of this.activePlugins) {
      const plugin = this.plugins.get(id);
      if (plugin) {
        plugin.disconnect();
        plugin.removeAllListeners();
        console.log(`[DeviceManager] Disconnected "${plugin.name}"`);
      }
    }
    this.activePlugins.clear();
  }

  /** Re-enumerate devices that support rescan (e.g. HID) without
   *  touching plugins that manage their own hotplug (e.g. 3Dconnexion). */
  async rescan(enabledIds?: string[]): Promise<void> {
    // Snapshot IDs to avoid mutating the set while iterating
    const toRescan = [...this.activePlugins].filter((id) => {
      const plugin = this.plugins.get(id);
      if (!plugin || !plugin.supportsRescan) return false;
      if (enabledIds?.length && !enabledIds.includes(id)) return false;
      return true;
    });

    for (const id of toRescan) {
      const plugin = this.plugins.get(id)!;
      plugin.disconnect();
      plugin.removeAllListeners();
      this.activePlugins.delete(id);
      console.log(`[DeviceManager] Rescanning "${plugin.name}"...`);

      this.wirePlugin(plugin);
      try {
        await plugin.connect();
        this.activePlugins.add(id);
        console.log(`[DeviceManager] Reconnected "${plugin.name}"`);
      } catch (err) {
        console.error(`[DeviceManager] Failed to reconnect "${plugin.name}":`, err);
      }
    }

    // Also try to start plugins that weren't active (newly available)
    for (const [id, plugin] of this.plugins) {
      if (this.activePlugins.has(id)) continue;
      if (!plugin.supportsRescan) continue;
      if (enabledIds?.length && !enabledIds.includes(id)) continue;
      if (!plugin.supportedPlatforms.includes(process.platform)) continue;

      const available = await plugin.isAvailable();
      if (!available) continue;

      this.wirePlugin(plugin);
      try {
        await plugin.connect();
        this.activePlugins.add(id);
        console.log(`[DeviceManager] Connected "${plugin.name}" (new)`);
      } catch (err) {
        console.error(`[DeviceManager] Failed to connect "${plugin.name}":`, err);
      }
    }
  }

  getConnectedDevices(): DeviceInfo[] {
    const devices: DeviceInfo[] = [];
    for (const id of this.activePlugins) {
      const plugin = this.plugins.get(id);
      if (plugin) {
        devices.push(...plugin.getDevices());
      }
    }
    return devices;
  }

  private wirePlugin(plugin: DevicePlugin): void {
    plugin.on("spatialData", (data: SpatialData) => this.emit("spatialData", data));
    plugin.on("buttonEvent", (data: ButtonEvent) => this.emit("buttonEvent", data));
    plugin.on("deviceConnected", (info: DeviceInfo) => this.emit("deviceConnected", info));
    plugin.on("deviceDisconnected", (info: DeviceInfo) => this.emit("deviceDisconnected", info));
    plugin.on("error", (err: Error) => this.emit("error", err));
  }
}
