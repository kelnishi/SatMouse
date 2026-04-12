import { WebTransportServer } from "./webtransport.js";
import { SatMouseWebSocketServer } from "./websocket.js";
import { LegacyServer } from "./legacy.js";
import type { DeviceManager } from "../devices/manager.js";
import type { SatMouseConfig } from "../config.js";
import { join } from "node:path";

/**
 * Manages both transport servers (WebTransport + WebSocket) and wires
 * them to the DeviceManager's event stream.
 */
export class TransportManager {
  private wt: WebTransportServer;
  private ws: SatMouseWebSocketServer;
  private legacy: LegacyServer;

  constructor(config: SatMouseConfig) {
    this.legacy = new LegacyServer();
    this.wt = new WebTransportServer(
      config.wtPort,
      join(config.certsDir, "cert.pem"),
      join(config.certsDir, "key.pem"),
    );
    this.ws = new SatMouseWebSocketServer(config.wsPort);
  }

  async start(deviceManager: DeviceManager, httpServer?: any): Promise<void> {
    // Wire device events to all transports (including legacy)
    deviceManager.on("spatialData", (data) => {
      this.wt.broadcastSpatialData(data);
      this.ws.broadcastSpatialData(data);
      this.legacy.handleSpatialData(data);
    });

    deviceManager.on("buttonEvent", (data) => {
      this.wt.broadcastButtonEvent(data);
      this.ws.broadcastButtonEvent(data);
      this.legacy.handleButtonEvent(data);
    });

    deviceManager.on("deviceConnected", (info) => {
      this.ws.broadcastDeviceStatus("connected", info);
    });

    deviceManager.on("deviceDisconnected", (info) => {
      this.ws.broadcastDeviceStatus("disconnected", info);
    });

    // Start WebSocket first (no TLS requirement)
    this.ws.start(httpServer);

    // Start legacy server on port 18944
    this.legacy.start();

    // Start WebTransport (requires TLS certs)
    try {
      await this.wt.start();
    } catch (err) {
      console.warn("[TransportManager] WebTransport failed to start (certs missing?). WebSocket-only mode.");
      console.warn("  Generate dev certs: npm run generate-certs");
    }
  }

  stop(): void {
    this.wt.stop();
    this.ws.stop();
    this.legacy.stop();
  }
}
