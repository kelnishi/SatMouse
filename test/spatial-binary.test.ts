import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeSpatialBinary } from "../src/transport/spatial-binary.ts";
import { decodeBinaryFrame, decodeWsBinaryFrame } from "../packages/client/src/core/decode.ts";
import { resolveEndpoints } from "../packages/client/src/core/discovery.ts";
import { parseNegotiateCallback } from "../packages/client/src/core/launch.ts";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCerts } from "../src/certs.ts";
import { TDServer } from "../src/discovery/td-server.ts";
import { DeviceManager } from "../src/devices/manager.ts";
import { SettingsStore } from "../src/settings.ts";
import type { SatMouseConfig } from "../src/config.ts";

const frame = {
  translation: { x: 1, y: -2, z: 3 },
  rotation: { x: -4, y: 5, z: 40000 },
  timestamp: 123456.5,
  deviceId: "oax-rotatrix",
};

test("binary frames carry the source device, which per-device settings are keyed by", () => {
  const decoded = decodeBinaryFrame(new Uint8Array(encodeSpatialBinary(frame)));
  assert.deepEqual(decoded, { ...frame, rotation: { x: -4, y: 5, z: 32767 } });

  const ws = decodeWsBinaryFrame(new Uint8Array(encodeSpatialBinary(frame, 0x01)));
  assert.equal(ws?.type, "spatialData");
  assert.equal(ws?.type === "spatialData" && ws.data.deviceId, "oax-rotatrix");
});

test("the device ID trails the 24-byte frame, so older clients read the axes unchanged", () => {
  const bytes = encodeSpatialBinary(frame);
  assert.equal(bytes.readInt16LE(8), 1);
  assert.equal(bytes.readUInt8(24), "oax-rotatrix".length);
  // A frame from an older bridge has no ID
  const old = decodeBinaryFrame(new Uint8Array(encodeSpatialBinary({ ...frame, deviceId: undefined })));
  assert.equal(old.deviceId, undefined);
  assert.equal(old.translation.y, -2);
  // A truncated ID is ignored, not misread
  assert.equal(decodeBinaryFrame(new Uint8Array(bytes.subarray(0, 28))).deviceId, undefined);
});

test("the WebTransport certificate hash is offered only under the name clients that read the device ID look for", async () => {
  const dir = mkdtempSync(join(tmpdir(), "satmouse-td-"));
  ensureCerts(dir);
  const config = {
    certsDir: dir, host: "127.0.0.1", wsPort: 18945, wtPort: 18946,
    controlToken: null, rotatrixConfigPath: join(dir, "rotatrix.yaml"),
  } as unknown as SatMouseConfig;
  const td = new TDServer(config, new DeviceManager(), new SettingsStore(join(dir, "settings.json")));
  const server = createServer((req, res) => (td as any).handleRequest(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const thing = await (await fetch(`${base}/td.json`)).json();
    // A client before 0.19.0 finds no hash, so Chrome keeps it on WebSocket JSON
    assert.equal(thing["satmouse:certHash"], undefined);
    assert.match(resolveEndpoints(thing).webtransport?.certHash ?? "", /^[A-Za-z0-9+/]{43}=$/);

    const res = await fetch(`${base}/negotiate?origin=https://example.test`, { redirect: "manual" });
    const params = new URL(res.headers.get("location")!).searchParams;
    assert.equal(params.get("certHash"), null);
    assert.equal(parseNegotiateCallback(params)?.certHash, resolveEndpoints(thing).webtransport?.certHash);
  } finally {
    server.close();
  }
});
