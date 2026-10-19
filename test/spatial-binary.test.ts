import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeSpatialBinary } from "../src/transport/spatial-binary.ts";
import { decodeBinaryFrame, decodeWsBinaryFrame } from "../packages/client/src/core/decode.ts";

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
