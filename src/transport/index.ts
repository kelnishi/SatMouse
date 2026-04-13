import { WebTransportServer } from "./webtransport.js";
import { SatMouseWebSocketServer } from "./websocket.js";
import { WebRTCServer } from "./webrtc.js";
import { LegacyServer } from "./legacy.js";
import type { DeviceManager } from "../devices/manager.js";
import type { SatMouseConfig } from "../config.js";
import { join } from "node:path";

/**
 * Manages all transport servers and wires them to the DeviceManager.
 *
 * - WebSocket on config.wsPort (default 18944) — satmouse-json/satmouse-binary
 * - Legacy JSON on same port, path /legacy — spacemouse-proxy compatible
 * - WebTransport on config.wtPort (default 18943)
 */
export class TransportManager {
  private wt: WebTransportServer;
  private ws: SatMouseWebSocketServer;
  private rtc: WebRTCServer;
  private legacy: LegacyServer;

  constructor(config: SatMouseConfig) {
    this.legacy = new LegacyServer();
    this.rtc = new WebRTCServer();
    this.wt = new WebTransportServer(
      config.wtPort,
      join(config.certsDir, "cert.pem"),
      join(config.certsDir, "key.pem"),
    );
    this.ws = new SatMouseWebSocketServer(config.wsPort);
  }

  async start(deviceManager: DeviceManager, httpServer?: any): Promise<void> {
    // Wire device events to all transports
    deviceManager.on("spatialData", (data) => {
      this.wt.broadcastSpatialData(data);
      this.ws.broadcastSpatialData(data);
      this.rtc.broadcastSpatialData(data);
      this.legacy.handleSpatialData(data);
    });

    deviceManager.on("buttonEvent", (data) => {
      this.wt.broadcastButtonEvent(data);
      this.ws.broadcastButtonEvent(data);
      this.rtc.broadcastButtonEvent(data);
      this.legacy.handleButtonEvent(data);
    });

    deviceManager.on("deviceConnected", (info) => {
      this.ws.broadcastDeviceStatus("connected", info);
      this.rtc.broadcastDeviceStatus("connected", info);
    });

    deviceManager.on("deviceDisconnected", (info) => {
      this.ws.broadcastDeviceStatus("disconnected", info);
      this.rtc.broadcastDeviceStatus("disconnected", info);
    });

    // Start WebSocket (attaches to httpServer)
    this.ws.start(httpServer);

    // Start legacy compatibility server on its own port (18944)
    this.legacy.start();

    // Start WebTransport (requires TLS certs)
    try {
      await this.wt.start();
    } catch (err) {
      console.warn("[TransportManager] WebTransport failed to start (certs missing?). WebSocket-only mode.");
      console.warn("  Generate dev certs: npm run generate-certs");
    }
  }

  /** Get the WebRTC server for signaling endpoint */
  get webrtc(): WebRTCServer {
    return this.rtc;
  }

  stop(): void {
    this.wt.stop();
    this.ws.stop();
    this.rtc.stop();
    this.legacy.stop();
  }
}
