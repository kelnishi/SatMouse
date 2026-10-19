/**
 * Mock OpenAxis 1.0 server for developing the OpenAxis plugin without a
 * Rotatrix. It follows the parts of SPEC.md the bridge depends on, including
 * active-client selection: motion goes only to the single connection
 * reporting `focus: true` (§4.2, §6.1).
 *
 * As a module: startMockOpenAxisServer() for tests.
 * As a script: `npx tsx scripts/mock-openaxis-server.ts [port]` streams a slow
 * spin every 3 s so the bridge can be run against it with
 * SATMOUSE_OPENAXIS_URL=ws://localhost:<port>.
 */
import { EventEmitter } from "node:events";
import { WebSocketServer, WebSocket } from "ws";
import { encode, decode } from "@msgpack/msgpack";
import type { AddressInfo } from "node:net";

type WireMap = Record<string, any>;

export interface MockConnection {
  ws: WebSocket;
  hello: WireMap | null;
  tags: string[];
  focused: boolean | null;
  axes: string[];
  /** Negotiated WebSocket extensions ("" when none) */
  extensions: string;
}

export interface MockOpenAxisServer {
  url: string;
  connections: Set<MockConnection>;
  /** Emits "message" (conn, msg) for every client message after decoding */
  events: EventEmitter;
  /** The unique focused connection, or null when none or ambiguous */
  active(): MockConnection | null;
  /** Stream a gesture of constant rates (rad/s) to the active client.
   *  Returns false if no client is active. */
  gesture(rates: Partial<Record<string, number>>, frames: number, intervalUs?: number): boolean;
  buttons(mask: number): boolean;
  close(): Promise<void>;
}

export async function startMockOpenAxisServer(port = 0): Promise<MockOpenAxisServer> {
  // Accepts permessage-deflate when offered, as Rotatrix's server does
  const wss = new WebSocketServer({ host: "127.0.0.1", port, perMessageDeflate: true });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const { port: boundPort } = wss.address() as AddressInfo;

  const connections = new Set<MockConnection>();
  const events = new EventEmitter();
  const start = performance.now();
  let seq = 0;
  let gestureId = 0;

  const send = (conn: MockConnection, msg: WireMap) => {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(encode(msg));
  };

  wss.on("connection", (ws) => {
    const conn: MockConnection = { ws, hello: null, tags: [], focused: null, axes: [], extensions: ws.extensions };
    connections.add(conn);
    ws.on("close", () => connections.delete(conn));
    ws.on("message", (data, isBinary) => {
      if (!isBinary) return;
      const msg = decode(data as Buffer) as WireMap;
      if (!conn.hello) {
        if (msg.type !== "hello") return ws.close();
        if (msg.proto !== "openaxis/1.0") {
          send(conn, { type: "error", code: "unsupported", message: "version" });
          return ws.close();
        }
        conn.hello = msg;
        send(conn, { type: "hello_ack", proto: "openaxis/1.0", server_name: "mock-openaxis" });
      } else if (msg.type === "tags") {
        conn.tags = msg.tags;
      } else if (msg.type === "focus") {
        conn.focused = msg.focused;
      } else if (msg.type === "subscribe") {
        conn.axes = msg.axes;
        send(conn, { type: "axes", axes: msg.axes });
      }
      events.emit("message", conn, msg);
    });
  });

  const server: MockOpenAxisServer = {
    url: `ws://localhost:${boundPort}`,
    connections,
    events,
    active() {
      const focused = [...connections].filter((c) => c.focused === true);
      return focused.length === 1 ? focused[0] : null;
    },
    gesture(rates, frames, intervalUs = 1000) {
      const conn = server.active();
      if (!conn) return false;
      const id = ++gestureId;
      send(conn, { type: "motion_start", gesture_id: id });
      let t = Math.round((performance.now() - start) * 1000);
      for (let i = 0; i < frames; i++) {
        t += intervalUs;
        send(conn, { type: "frame", seq: ++seq, t_us: t, values: conn.axes.map((a) => rates[a] ?? 0) });
      }
      send(conn, { type: "motion_end", gesture_id: id });
      return true;
    },
    buttons(mask) {
      const conn = server.active();
      if (!conn) return false;
      send(conn, { type: "buttons", buttons: mask });
      return true;
    },
    close() {
      for (const conn of connections) conn.ws.terminate();
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
  return server;
}

if (process.argv[1]?.endsWith("mock-openaxis-server.ts")) {
  const port = parseInt(process.argv[2] ?? "6607", 10);
  const server = await startMockOpenAxisServer(port);
  console.log(`Mock OpenAxis server on ${server.url}`);
  server.events.on("message", (conn: MockConnection, msg: WireMap) => {
    if (msg.type !== "heartbeat") console.log(`← ${conn.hello?.client_name ?? "?"}: ${JSON.stringify(msg)}`);
  });
  setInterval(() => {
    // 500 ms of a 1 rad/s spin about the vertical axis
    const sent = server.gesture({ ry: 1 }, 500);
    console.log(sent ? "→ gesture to focused client" : "· no focused client; holding input");
  }, 3000);
}
