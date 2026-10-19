import { DevicePlugin, type DeviceInfo } from "../../types.js";
import type { OpenAxisActivation } from "../../../settings.js";
import { isLoopbackAddress } from "../../../focus.js";
import { OpenAxisClient, STANDARD_AXES } from "./client.js";

const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 15000;
/** Output interval. OpenAxis servers may stream at the device's 1 kHz; SatMouse
 *  consumers expect SpaceMouse-like rates, so frames are averaged into windows. */
const EMIT_INTERVAL_S = 0.008;
/** Emit a zero frame if a gesture goes quiet without motion_end. Rotatrix's
 *  frame gaps regularly exceed 50 ms mid-roll, so a shorter timeout stutters. */
const IDLE_TIMEOUT_MS = 150;

/**
 * OpenAxis plugin — receives Rotatrix 3D trackball input from the Rotatrix
 * desktop app over the OpenAxis Axis Streaming interface.
 *
 * The Rotatrix app owns the device; its USB protocol is not public. It sends
 * input only to the client it selects as active, by foreground process or by
 * a unique `focus: true`. The bridge reports the focus of its local web
 * clients (see FocusTracker), so input flows while a SatMouse page is focused.
 *
 * Axis values are ball angular rates in rad/s after the user's Rotatrix
 * mapping and gains. They are re-framed from OpenAxis (+x right, +y up,
 * −z forward) to SatMouse's frame (+x right, +y forward, +z up) and scaled
 * by `gain` into SpaceMouse-like device units.
 *
 * Rotatrix chooses its control profile from the active client's tags. The
 * bridge sends `app.satmouse` and `satmouse.activation.<hold|always>`, which
 * the SatMouse Rotatrix profile (rotatrix-profile.ts) keys on.
 */
export class OpenAxisPlugin extends DevicePlugin {
  readonly id = "openaxis";
  readonly name = "OpenAxis (Rotatrix)";
  readonly supportedPlatforms: NodeJS.Platform[] = ["darwin", "win32", "linux"];

  private client: OpenAxisClient | null = null;
  private device: DeviceInfo | null = null;
  private running = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_MIN_MS;
  private focused = false;

  private axisOrder: string[] = [...STANDARD_AXES];
  private prevTUs: number | null = null;
  private windowTravel = [0, 0, 0, 0, 0, 0];
  private windowDt = 0;
  private moving = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private prevButtons = 0;

  constructor(
    private readonly url: string,
    private readonly gain: number,
    private activation: OpenAxisActivation,
    private readonly clientVersion?: string,
  ) {
    super();
  }

  /** Switch between hold-to-activate and always-on 3D input */
  setActivation(activation: OpenAxisActivation): void {
    this.activation = activation;
    this.client?.setTags(this.tags());
  }

  private tags(): string[] {
    return ["app.satmouse", `satmouse.activation.${this.activation}`];
  }

  /** Available whenever the endpoint is valid. The Rotatrix app may start
   *  after the bridge, so connect() keeps retrying in the background. */
  async isAvailable(): Promise<boolean> {
    try {
      const url = new URL(this.url);
      // §12: OpenAxis assumes a trusted local connection
      const local = url.hostname === "localhost" || isLoopbackAddress(url.hostname);
      if (url.protocol !== "ws:" || !local) {
        console.warn(`[OpenAxis] Ignoring non-local endpoint ${this.url}`);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    this.running = true;
    this.retryDelay = RETRY_MIN_MS;
    this.attempt();
  }

  disconnect(): void {
    this.running = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.client?.close();
    this.client = null;
    this.endMotion();
    this.markDisconnected();
  }

  getDevices(): DeviceInfo[] {
    return this.device ? [this.device] : [];
  }

  setHostFocus(focused: boolean): void {
    this.focused = focused;
    this.client?.setFocus(focused);
  }

  private async attempt(): Promise<void> {
    if (!this.running) return;
    const client = new OpenAxisClient({
      url: this.url,
      clientName: "SatMouse",
      clientVersion: this.clientVersion,
      tags: this.tags(),
      axes: STANDARD_AXES,
    });
    client.setFocus(this.focused);
    this.wire(client);
    this.client = client;

    try {
      const serverName = await client.connect();
      if (!this.running || this.client !== client) {
        client.close();
        return;
      }
      this.retryDelay = RETRY_MIN_MS;
      console.log(`[OpenAxis] Connected to ${serverName} at ${this.url}`);
      this.markConnected(serverName);
    } catch {
      if (this.client === client) this.client = null;
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.attempt();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
  }

  private wire(client: OpenAxisClient): void {
    client.on("axes", (axes) => {
      this.axisOrder = axes;
    });

    client.on("motionStart", () => {
      // A new gesture restarts timing; travel from the old one is flushed
      this.flush();
      this.prevTUs = null;
    });

    client.on("motionEnd", () => this.endMotion());

    client.on("frame", (_seq, tUs, values) => this.onFrame(tUs, values));

    client.on("buttons", (mask) => {
      const timestamp = performance.now() * 1000;
      const changed = mask ^ this.prevButtons;
      for (let i = 0; i < 32; i++) {
        const bit = 2 ** i;
        if (Math.floor(changed / bit) % 2) {
          this.emit("buttonEvent", { button: i, pressed: Math.floor(mask / bit) % 2 === 1, timestamp });
        }
      }
      this.prevButtons = mask;
    });

    client.on("close", (code, reason) => {
      if (this.client !== client) return;
      this.client = null;
      console.log(`[OpenAxis] Disconnected (code ${code}${reason ? `: ${reason}` : ""})`);
      this.endMotion();
      this.releaseButtons();
      this.markDisconnected();
      this.scheduleRetry();
    });
  }

  private onFrame(tUs: number, values: number[]): void {
    // Each value is already a rate; dt only weights frames within a window.
    // A frame with no predecessor (gesture start) counts as one full window,
    // so it is emitted at once instead of waiting for the next frame.
    const dt = this.prevTUs === null || tUs <= this.prevTUs
      ? EMIT_INTERVAL_S
      : (tUs - this.prevTUs) / 1_000_000;
    this.prevTUs = tUs;

    const v: Record<string, number> = {};
    this.axisOrder.forEach((name, i) => { v[name] = values[i] ?? 0; });
    const mapped = [
      v.tx ?? 0, -(v.tz ?? 0), v.ty ?? 0,
      v.rx ?? 0, -(v.rz ?? 0), v.ry ?? 0,
    ];
    for (let i = 0; i < 6; i++) this.windowTravel[i] += mapped[i] * dt;
    this.windowDt += dt;

    if (this.windowDt >= EMIT_INTERVAL_S) this.flush();

    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.settle(), IDLE_TIMEOUT_MS);
  }

  /** The gesture went quiet: stop consumers without losing the frame clock */
  private settle(): void {
    this.idleTimer = null;
    this.flush();
    if (this.moving) this.emitSpatial([0, 0, 0, 0, 0, 0]);
  }

  /** Emit the window's mean rate and start a new window */
  private flush(): void {
    if (this.windowDt <= 0) return;
    const rate = this.windowTravel.map((travel) => (travel / this.windowDt) * this.gain);
    this.windowTravel = [0, 0, 0, 0, 0, 0];
    this.windowDt = 0;
    this.emitSpatial(rate);
  }

  /** Flush pending travel, then settle consumers at zero */
  private endMotion(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.flush();
    this.prevTUs = null;
    if (this.moving) this.emitSpatial([0, 0, 0, 0, 0, 0]);
  }

  private emitSpatial(r: number[]): void {
    this.moving = r.some((x) => x !== 0);
    this.emit("spatialData", {
      translation: { x: r[0], y: r[1], z: r[2] },
      rotation: { x: r[3], y: r[4], z: r[5] },
      timestamp: performance.now() * 1000,
      deviceId: this.device?.id ?? "oax",
    });
  }

  /** Release any held buttons when the server goes away */
  private releaseButtons(): void {
    if (this.prevButtons === 0) return;
    const timestamp = performance.now() * 1000;
    for (let i = 0; i < 32; i++) {
      if (Math.floor(this.prevButtons / 2 ** i) % 2) {
        this.emit("buttonEvent", { button: i, pressed: false, timestamp });
      }
    }
    this.prevButtons = 0;
  }

  private markConnected(serverName: string): void {
    const rotatrix = serverName.toLowerCase().startsWith("rotatrix");
    this.device = {
      id: `oax-${serverName.replace(/[^a-z0-9-]/gi, "").slice(0, 32) || "server"}`,
      name: rotatrix ? "Rotatrix" : `OpenAxis (${serverName})`,
      model: rotatrix ? "Rotatrix" : serverName,
      vendor: rotatrix ? "Rotatrix" : "OpenAxis",
      vendorId: 0,
      productId: 0,
      // OpenAxis doesn't report the link; Rotatrix's 3D mode works only over
      // its USB cable (the Hybrid edition is a 2D-only mouse when wireless)
      connectionType: "usb",
      deviceClass: "trackball",
      axes: [...STANDARD_AXES],
    };
    this.emit("deviceConnected", this.device);
  }

  private markDisconnected(): void {
    if (!this.device) return;
    const device = this.device;
    this.device = null;
    this.emit("deviceDisconnected", device);
  }
}
