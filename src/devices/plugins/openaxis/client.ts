import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { encode, Decoder } from "@msgpack/msgpack";

/**
 * Minimal OpenAxis 1.0 Axis Streaming client, written from the protocol
 * specification (SPEC.md in github.com/rotatrix/openaxis) rather than linked
 * against the ELv2/GPLv3 SDK, so the bridge stays MIT.
 *
 * Wire format: one MessagePack map per binary WebSocket message, each with a
 * string `type`. This client implements only what the bridge needs:
 * hello/hello_ack, heartbeat, tags, focus, subscribe/axes/frame, the motion
 * lifecycle and the `buttons` bitmask. It declares no capabilities, so the
 * server never sends Navigation queries; any request it does send is answered
 * `unsupported`, as §10 requires.
 */

export const OPENAXIS_PROTOCOL = "openaxis/1.0";
export const STANDARD_AXES = ["tx", "ty", "tz", "rx", "ry", "rz"] as const;

const HANDSHAKE_TIMEOUT_MS = 5000;
/** §3.4: heartbeat every 1–2 s while idle; reference server timeout is 5 s */
const HEARTBEAT_MS = 1500;
/** §12: bound message size and decoder collections */
const MAX_MESSAGE_BYTES = 64 * 1024;
/** SATMOUSE_OPENAXIS_DEBUG=1 traces every message except frames and heartbeats */
const DEBUG = !!process.env.SATMOUSE_OPENAXIS_DEBUG;

type WireMap = Record<string, unknown>;

interface OpenAxisClientEvents {
  axes: [axes: string[]];
  frame: [seq: number, tUs: number, values: number[]];
  motionStart: [gestureId: number];
  motionEnd: [gestureId: number];
  buttons: [mask: number];
  close: [code: number, reason: string];
}

export interface OpenAxisClientOptions {
  url: string;
  clientName: string;
  clientVersion?: string;
  tags: string[];
  axes: readonly string[];
}

const decoder = new Decoder({
  maxStrLength: 4096,
  maxBinLength: 4096,
  maxArrayLength: 256,
  maxMapLength: 64,
  maxExtLength: 0,
});

export class OpenAxisClient extends EventEmitter<OpenAxisClientEvents> {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastSendAt = 0;
  private ready = false;
  private focused = false;
  private tags: string[];
  private gestureId: number | null = null;
  private lastSeq = -1;
  private timing = new FrameTiming();

  constructor(private readonly options: OpenAxisClientOptions) {
    super();
    this.tags = [...options.tags];
  }

  /** Open the socket and complete the hello handshake. Resolves with the
   *  server's name. Rejects if the server is absent or refuses the version. */
  connect(): Promise<string> {
    // Counters and gestures are connection-scoped (§3.3)
    this.lastSeq = -1;
    this.gestureId = null;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.options.url, { maxPayload: MAX_MESSAGE_BYTES });
      this.socket = socket;
      let settled = false;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.terminate();
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error("OpenAxis handshake timeout")), HANDSHAKE_TIMEOUT_MS);

      socket.on("open", () => {
        this.send({
          type: "hello",
          proto: OPENAXIS_PROTOCOL,
          client_name: this.options.clientName,
          ...(this.options.clientVersion && { client_version: this.options.clientVersion }),
          // No `target`: the input recipient is a browser page, and the process
          // that owns its socket is not the foreground app. A wrong PID would
          // exclude this connection (§4.2), so focus alone identifies it.
        });
      });

      socket.on("message", (data, isBinary) => {
        // §3.2: text messages are not OpenAxis messages
        if (!isBinary) return;
        let msg: WireMap;
        try {
          msg = decodeMessage(data as Buffer);
        } catch (err) {
          if (DEBUG) console.log(`[OpenAxis] ← undecodable ${(data as Buffer).length} bytes: ${(err as Error).message}`);
          return;
        }
        if (DEBUG && msg.type !== "frame") console.log(`[OpenAxis] ← ${JSON.stringify(msg)}`);

        if (!settled) {
          if (msg.type === "hello_ack" && msg.proto === OPENAXIS_PROTOCOL) {
            settled = true;
            clearTimeout(timer);
            this.onHandshake();
            resolve(typeof msg.server_name === "string" ? msg.server_name : "unknown");
          } else if (msg.type === "error") {
            fail(new Error(`OpenAxis server refused hello: ${String(msg.code)}`));
          }
          return;
        }
        this.handle(msg);
      });

      socket.on("error", (err) => fail(err));
      socket.on("close", (code, reason) => {
        fail(new Error(`OpenAxis connection closed during handshake (${code})`));
        if (this.socket === socket) this.onClose(code, reason.toString());
      });
    });
  }

  close(): void {
    this.socket?.close();
  }

  /** Report whether a page that receives the bridge's input has focus */
  setFocus(focused: boolean): void {
    if (focused === this.focused) return;
    this.focused = focused;
    if (this.ready) this.send({ type: "focus", focused });
  }

  /** Replace the context tags (§4.1: each message is a full replacement set) */
  setTags(tags: string[]): void {
    this.tags = [...tags];
    if (this.ready) this.send({ type: "tags", tags: this.tags });
  }

  private onHandshake(): void {
    this.ready = true;
    this.send({ type: "tags", tags: this.tags });
    // §4.2: send the current state after hello_ack. `false` is a real state
    // here — no local page has reported focus — not a placeholder.
    this.send({ type: "focus", focused: this.focused });
    this.send({ type: "subscribe", axes: [...this.options.axes] });
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSendAt >= HEARTBEAT_MS) this.send({ type: "heartbeat" });
    }, HEARTBEAT_MS / 3);
  }

  private onClose(code: number, reason: string): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.socket = null;
    if (this.gestureId !== null) this.emit("motionEnd", this.gestureId);
    this.gestureId = null;
    const wasReady = this.ready;
    this.ready = false;
    if (wasReady) this.emit("close", code, reason);
  }

  private handle(msg: WireMap): void {
    switch (msg.type) {
      case "axes":
        if (isStringArray(msg.axes)) this.emit("axes", msg.axes);
        break;

      case "frame": {
        const { seq, t_us, values } = msg;
        if (!isId(seq) || !isId(t_us) || !isNumberArray(values)) return;
        // §11.2: discard frames that are not newer than the last accepted
        if (seq <= this.lastSeq) return;
        this.lastSeq = seq;
        if (DEBUG) this.timing.add(t_us);
        this.emit("frame", seq, t_us, values);
        break;
      }

      case "motion_start":
        if (!isId(msg.gesture_id)) return;
        // §6.3: a new motion_start replaces the active gesture without motion_end
        this.gestureId = msg.gesture_id;
        if (DEBUG) this.timing.reset();
        this.emit("motionStart", msg.gesture_id);
        break;

      case "motion_end":
        // §6.3: ignore an end for any gesture other than the active one
        if (msg.gesture_id !== this.gestureId || this.gestureId === null) return;
        this.gestureId = null;
        if (DEBUG) console.log(`[OpenAxis] gesture ${msg.gesture_id}: ${this.timing.summary()}`);
        this.emit("motionEnd", msg.gesture_id as number);
        break;

      case "buttons":
        if (isId(msg.buttons)) this.emit("buttons", msg.buttons);
        break;

      case "request":
        // No capabilities declared, so no method is implemented (§5, §10)
        if (isId(msg.id)) {
          this.send({
            type: "response",
            id: msg.id,
            error: { code: "unsupported", message: "Axis Streaming client" },
          });
        }
        break;

      case "error":
        console.warn(`[OpenAxis] Server error: ${String(msg.code)}`);
        break;

      // §3.2: ignore unknown message types
    }
  }

  private send(msg: WireMap): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (DEBUG && msg.type !== "heartbeat") console.log(`[OpenAxis] → ${JSON.stringify(msg)}`);
    try {
      this.socket.send(encode(msg));
      this.lastSendAt = Date.now();
    } catch {
      // close handler cleans up
    }
  }
}

/**
 * Debug-only frame timing for one gesture. Source gaps come from the server's
 * t_us; arrival gaps from the bridge's clock. Queueing is how far a frame's
 * arrival trails its t_us, relative to the least-delayed frame: growth there
 * means delay between server and bridge rather than at the source.
 */
class FrameTiming {
  private frames = 0;
  private lastT = 0;
  private lastArrival = 0;
  private sourceGaps: number[] = [];
  private arrivalGaps: number[] = [];
  private minOffset = Infinity;
  private maxQueue = 0;

  reset(): void {
    this.frames = 0;
    this.sourceGaps = [];
    this.arrivalGaps = [];
    this.minOffset = Infinity;
    this.maxQueue = 0;
  }

  add(tUs: number): void {
    const arrival = performance.now();
    if (this.frames > 0) {
      this.sourceGaps.push((tUs - this.lastT) / 1000);
      this.arrivalGaps.push(arrival - this.lastArrival);
    }
    const offset = arrival - tUs / 1000;
    this.minOffset = Math.min(this.minOffset, offset);
    this.maxQueue = Math.max(this.maxQueue, offset - this.minOffset);
    this.lastT = tUs;
    this.lastArrival = arrival;
    this.frames++;
  }

  summary(): string {
    const stat = (xs: number[]) => xs.length
      ? `mean ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)} / p95 ${[...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)].toFixed(1)} / max ${Math.max(...xs).toFixed(1)} ms`
      : "n/a";
    return `${this.frames} frames; source gap ${stat(this.sourceGaps)}; arrival gap ${stat(this.arrivalGaps)}; max queueing ${this.maxQueue.toFixed(1)} ms`;
  }
}

function decodeMessage(data: Buffer): WireMap {
  const msg = decoder.decode(data);
  if (msg === null || typeof msg !== "object" || Array.isArray(msg) || msg instanceof Uint8Array) {
    throw new Error("not a map");
  }
  if (typeof (msg as WireMap).type !== "string") throw new Error("missing type");
  return msg as WireMap;
}

/** §3.2: identifiers, counters and timestamps are integers in 0..2^53−1 */
function isId(v: unknown): v is number {
  return Number.isSafeInteger(v) && (v as number) >= 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x));
}
