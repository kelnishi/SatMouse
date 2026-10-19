import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import { startMockOpenAxisServer, type MockOpenAxisServer, type MockConnection } from "../scripts/mock-openaxis-server.ts";
import { DeviceManager } from "../src/devices/manager.ts";
import { OpenAxisPlugin } from "../src/devices/plugins/openaxis/index.ts";
import { FocusTracker, isLoopbackAddress } from "../src/focus.ts";
import { SatMouseWebSocketServer } from "../src/transport/websocket.ts";
import type { DeviceInfo, SpatialData, ButtonEvent } from "../src/devices/types.ts";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsStore } from "../src/settings.ts";
import { TDServer } from "../src/discovery/td-server.ts";
import type { SatMouseConfig } from "../src/config.ts";

const GAIN = 50;

let mock: MockOpenAxisServer;
let http: Server;
let wsServer: SatMouseWebSocketServer;
let devices: DeviceManager;
let bridgeUrl: string;
let plugin: OpenAxisPlugin;

/** Resolve when the mock receives a matching message from the bridge */
function nextMessage(type: string, match: (msg: any) => boolean = () => true): Promise<any> {
  return new Promise((resolve) => {
    const onMessage = (_conn: MockConnection, msg: any) => {
      if (msg.type === type && match(msg)) {
        mock.events.off("message", onMessage);
        resolve(msg);
      }
    };
    mock.events.on("message", onMessage);
  });
}

async function openPage(): Promise<{ ws: WebSocket; messages: any[] }> {
  const ws = new WebSocket(`${bridgeUrl}/spatial`, "satmouse-json");
  const messages: any[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await once(ws, "open");
  return { ws, messages };
}

async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

before(async () => {
  mock = await startMockOpenAxisServer();

  const focus = new FocusTracker();
  devices = new DeviceManager();
  focus.on("change", (focused) => devices.setHostFocus(focused));
  plugin = new OpenAxisPlugin(mock.url, GAIN, "hold", "test");
  devices.registerPlugin(plugin);

  const connected = once(devices, "deviceConnected");
  const subscribed = nextMessage("subscribe");
  await devices.start(["openaxis"]);
  const [info] = (await connected) as [DeviceInfo];
  assert.equal(info.deviceClass, "trackball");
  await subscribed;

  http = createServer();
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  bridgeUrl = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
  wsServer = new SatMouseWebSocketServer(0);
  wsServer.setFocusTracker(focus);
  wsServer.start(http);
  devices.on("spatialData", (d: SpatialData) => wsServer.broadcastSpatialData(d));
  devices.on("buttonEvent", (b: ButtonEvent) => wsServer.broadcastButtonEvent(b));
});

after(async () => {
  devices.stop();
  wsServer.stop();
  http.close();
  await mock.close();
});

test("handshake declares a client without a target and starts unfocused", () => {
  const [conn] = mock.connections;
  assert.equal(conn.hello?.client_name, "SatMouse");
  assert.equal(conn.hello?.target, undefined);
  assert.deepEqual(conn.tags, ["app.satmouse", "satmouse.activation.hold"]);
  assert.equal(conn.focused, false);
  assert.deepEqual(conn.axes, ["tx", "ty", "tz", "rx", "ry", "rz"]);
  // A deflated stream is read one message per event-loop turn (see client.ts)
  assert.equal(conn.extensions, "");
});

test("a focused page makes the bridge the active OpenAxis client and receives re-framed rates", async () => {
  const page = await openPage();
  const focused = nextMessage("focus", (m) => m.focused === true);
  page.ws.send(JSON.stringify({ type: "focus", focused: true }));
  await focused;
  assert.ok(mock.active(), "bridge should be the unique focused client");

  // OpenAxis +ty (up) → SatMouse +tz; OpenAxis +tz (toward viewer) → SatMouse −ty
  mock.gesture({ ty: 2, tz: 1, rx: 1 }, 100);
  await until(() => page.messages.some((m) => m.type === "spatialData" && m.data.translation.z === 0 && m.data.rotation.x === 0));

  const frames = page.messages.filter((m) => m.type === "spatialData").map((m) => m.data);
  const moving = frames.filter((f) => f.translation.z !== 0);
  assert.ok(moving.length > 0);
  for (const f of moving) {
    assert.ok(Math.abs(f.translation.z - 2 * GAIN) < 1e-9, `tz ${f.translation.z}`);
    assert.ok(Math.abs(f.translation.y - -1 * GAIN) < 1e-9, `ty ${f.translation.y}`);
    assert.ok(Math.abs(f.rotation.x - 1 * GAIN) < 1e-9, `rx ${f.rotation.x}`);
    assert.equal(f.translation.x, 0);
  }
  // ~100 ms of 1 kHz frames is downsampled to ~8 ms windows
  assert.ok(moving.length <= 15, `expected downsampling, got ${moving.length} frames`);
  // The gesture ends on a zero frame
  const last = frames[frames.length - 1];
  assert.deepEqual([last.translation, last.rotation], [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]);

  // Buttons arrive as press/release events from the bitmask
  mock.buttons(0b101);
  await until(() => page.messages.filter((m) => m.type === "buttonEvent").length >= 2);
  const pressed = page.messages.filter((m) => m.type === "buttonEvent").map((m) => [m.data.button, m.data.pressed]);
  assert.deepEqual(pressed, [[0, true], [2, true]]);
  mock.buttons(0);

  const unfocused = nextMessage("focus", (m) => m.focused === false);
  page.ws.send(JSON.stringify({ type: "focus", focused: false }));
  await unfocused;
  assert.equal(mock.active(), null);
  page.ws.close();
});

test("the first frame of a gesture is emitted, not used only to start the clock", async () => {
  const page = await openPage();
  const focused = nextMessage("focus", (m) => m.focused === true);
  page.ws.send(JSON.stringify({ type: "focus", focused: true }));
  await focused;

  mock.gesture({ rx: 1 }, 1);
  await until(() => page.messages.some((m) => m.type === "spatialData" && m.data.rotation.x !== 0));
  const first = page.messages.find((m) => m.type === "spatialData" && m.data.rotation.x !== 0);
  assert.ok(Math.abs(first.data.rotation.x - GAIN) < 1e-9);

  const unfocused = nextMessage("focus", (m) => m.focused === false);
  page.ws.close();
  await unfocused;
});

test("focus is the OR of pages and a closed page loses its vote", async () => {
  const a = await openPage();
  const b = await openPage();

  const focused = nextMessage("focus", (m) => m.focused === true);
  a.ws.send(JSON.stringify({ type: "focus", focused: true }));
  b.ws.send(JSON.stringify({ type: "focus", focused: false }));
  await focused;

  const cleared = nextMessage("focus", (m) => m.focused === false);
  a.ws.close();
  await cleared;
  assert.equal(mock.active(), null);
  b.ws.close();
});

test("malformed client messages are ignored", async () => {
  const page = await openPage();
  let sawFocus = false;
  const onMessage = (_c: MockConnection, m: any) => { if (m.type === "focus") sawFocus = true; };
  mock.events.on("message", onMessage);
  page.ws.send(JSON.stringify({ type: "focus", focused: "yes" }));
  page.ws.send("not json");
  page.ws.send(Buffer.from([1, 2, 3]));
  await new Promise((r) => setTimeout(r, 100));
  mock.events.off("message", onMessage);
  assert.equal(sawFocus, false);
  page.ws.close();
});

test("only loopback peers count as local", () => {
  for (const addr of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.0.0.1:5000", "[::1]:5000", "[::ffff:127.0.0.1]:443"]) {
    assert.equal(isLoopbackAddress(addr), true, addr);
  }
  for (const addr of [undefined, "", "192.168.1.5", "::ffff:192.168.1.5", "10.0.0.1:5000", "[fe80::1]:5000", "0.0.0.0", "128.0.0.1"]) {
    assert.equal(isLoopbackAddress(addr), false, String(addr));
  }
});

test("changing activation replaces the tag set on the live connection", async () => {
  const always = nextMessage("tags", (m) => m.tags.includes("satmouse.activation.always"));
  plugin.setActivation("always");
  assert.deepEqual((await always).tags, ["app.satmouse", "satmouse.activation.always"]);
  const hold = nextMessage("tags", (m) => m.tags.includes("satmouse.activation.hold"));
  plugin.setActivation("hold");
  await hold;
});

test("the activation endpoint needs the control token and persists the setting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "satmouse-test-"));
  const settingsPath = join(dir, "settings.json");
  const settings = new SettingsStore(settingsPath);
  const config = { certsDir: dir, controlToken: "secret-token" } as SatMouseConfig;
  const td = new TDServer(config, devices, settings);
  const server = createServer((req, res) => (td as any).handleRequest(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/openaxis`;
  const post = (body: unknown, token?: string) => fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token && { "X-SatMouse-Control": token }) },
    body: JSON.stringify(body),
  });

  try {
    assert.deepEqual(await (await fetch(base)).json(), { activation: "hold" });
    assert.equal((await post({ activation: "always" })).status, 403);
    assert.equal((await post({ activation: "always" }, "wrong-token!")).status, 403);
    assert.equal((await post({ activation: "sometimes" }, "secret-token")).status, 400);

    const changed = once(settings, "change");
    const res = await post({ activation: "always" }, "secret-token");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { activation: "always" });
    await changed;
    assert.equal(JSON.parse(readFileSync(settingsPath, "utf-8")).openaxisActivation, "always");
    assert.equal(new SettingsStore(settingsPath).get().openaxisActivation, "always");
  } finally {
    server.close();
  }

  // Without a token (dev mode) writes are disabled outright
  const devTd = new TDServer({ certsDir: dir, controlToken: null } as SatMouseConfig, devices, settings);
  const devServer = createServer((req, res) => (devTd as any).handleRequest(req, res));
  await new Promise<void>((resolve) => devServer.listen(0, "127.0.0.1", resolve));
  try {
    const devBase = `http://127.0.0.1:${(devServer.address() as AddressInfo).port}/api/openaxis`;
    const res = await fetch(devBase, { method: "POST", headers: { "X-SatMouse-Control": "" }, body: "{}" });
    assert.equal(res.status, 403);
  } finally {
    devServer.close();
  }
});

test("the plugin reconnects after the OpenAxis server restarts", async () => {
  const port = new URL(mock.url).port;
  const lost = once(devices, "deviceDisconnected");
  await mock.close();
  await lost;

  mock = await startMockOpenAxisServer(parseInt(port, 10));
  const [info] = (await once(devices, "deviceConnected")) as [DeviceInfo];
  assert.equal(info.name, "OpenAxis (mock-openaxis)");
});
