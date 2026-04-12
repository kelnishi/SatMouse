import { WebSocketServer, WebSocket } from "ws";
import type { SpatialData, ButtonEvent } from "../devices/types.js";

const LEGACY_PORT = 18944;
const TICK_MS = 16; // ~60 Hz
const DEAD_ZONE = 3;
const SCALE = 350.0;
const SMOOTH_ALPHA = 0.4;
const SNAP_THRESHOLD = 0.003;

/**
 * Legacy compatibility server on port 18944.
 *
 * Implements the spacemouse-proxy protocol (bimawa/spacemouse-proxy):
 *   - WebSocket on ws://127.0.0.1:18944
 *   - JSON messages: { "axes": [x, y, z, rx, ry, rz], "buttons": 0 }
 *   - Axes normalized to [-1.0, 1.0] (raw / 350, clamped)
 *   - Dead zone filtering, exponential moving average smoothing
 *   - ~60 fps broadcast to all connected clients
 *
 * Receives events from the DeviceManager, so any device plugin
 * (SpaceMouse, gamepad, HID, etc.) is forwarded to legacy clients.
 */
export class LegacyServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  // Current raw axes (accumulated from device events)
  private rawAxes = [0, 0, 0, 0, 0, 0];
  // Smoothed axes (EMA filtered)
  private smoothAxes = [0, 0, 0, 0, 0, 0];
  // Current button state
  private buttons = 0;

  start(): void {
    this.wss = new WebSocketServer({ port: LEGACY_PORT, host: "127.0.0.1" });

    this.wss.on("connection", (ws: WebSocket) => {
      this.clients.add(ws);
      console.log(`[Legacy] Client connected (${this.clients.size} total)`);

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log(`[Legacy] Client disconnected (${this.clients.size} total)`);
      });

      ws.on("error", () => {
        this.clients.delete(ws);
      });
    });

    // Broadcast at ~60 Hz
    this.tickTimer = setInterval(() => {
      this.updateSmoothing();
      this.broadcast();
    }, TICK_MS);

    console.log(`[Legacy] Listening on ws://127.0.0.1:${LEGACY_PORT}`);
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    for (const ws of this.clients) {
      try { ws.close(); } catch {}
    }
    this.clients.clear();
    this.wss?.close();
    console.log("[Legacy] Stopped");
  }

  /** Called by the transport manager when spatial data arrives from any device */
  handleSpatialData(data: SpatialData): void {
    this.rawAxes[0] = data.translation.x;
    this.rawAxes[1] = data.translation.y;
    this.rawAxes[2] = data.translation.z;
    this.rawAxes[3] = data.rotation.x;
    this.rawAxes[4] = data.rotation.y;
    this.rawAxes[5] = data.rotation.z;
  }

  /** Called by the transport manager when button state changes */
  handleButtonEvent(data: ButtonEvent): void {
    if (typeof data.button !== "number" || data.button < 0 || data.button > 31) return;
    const bit = data.button | 0;
    if (data.pressed) {
      this.buttons |= (1 << bit);
    } else {
      this.buttons &= ~(1 << bit);
    }
  }

  private updateSmoothing(): void {
    for (let i = 0; i < 6; i++) {
      // Dead zone: zero out raw values near center
      const raw = Math.abs(this.rawAxes[i]) < DEAD_ZONE ? 0 : this.rawAxes[i];

      // Normalize to [-1, 1]
      const target = Math.max(-1, Math.min(1, raw / SCALE));

      // Exponential moving average
      this.smoothAxes[i] = this.smoothAxes[i] * (1 - SMOOTH_ALPHA) + target * SMOOTH_ALPHA;

      // Snap to zero below threshold
      if (Math.abs(this.smoothAxes[i]) < SNAP_THRESHOLD) {
        this.smoothAxes[i] = 0;
      }
    }
  }

  private broadcast(): void {
    if (this.clients.size === 0) return;

    const msg = JSON.stringify({
      axes: [
        this.smoothAxes[0],
        this.smoothAxes[1],
        this.smoothAxes[2],
        this.smoothAxes[3],
        this.smoothAxes[4],
        this.smoothAxes[5],
      ],
      buttons: this.buttons,
    });

    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(msg); } catch {}
      }
    }
  }
}
