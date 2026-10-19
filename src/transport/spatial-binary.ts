import type { SpatialData } from "../devices/types.js";

/** Longest device ID the 1-byte length can carry */
const MAX_DEVICE_ID_BYTES = 255;

const deviceIdBytes = new Map<string, Buffer>();

/** UTF-8 bytes of a device ID, cached since every frame repeats it; empty if absent or too long */
function encodeDeviceId(deviceId: string | undefined): Buffer {
  if (!deviceId) return Buffer.alloc(0);
  let bytes = deviceIdBytes.get(deviceId);
  if (!bytes) {
    bytes = Buffer.from(deviceId, "utf-8");
    if (bytes.length > MAX_DEVICE_ID_BYTES) bytes = Buffer.alloc(0);
    deviceIdBytes.set(deviceId, bytes);
  }
  return bytes;
}

/** Clamp a number to int16 range, reject NaN/Infinity */
function clampInt16(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-32768, Math.min(32767, Math.round(v)));
}

/**
 * Encode SpatialData as the 24-byte binary frame (see docs/protocol.md),
 * followed by the source device ID so clients can apply per-device settings.
 * Clients that predate the ID read the first 24 bytes and ignore the rest.
 * `typePrefix` prepends the WebSocket binary message type byte.
 */
export function encodeSpatialBinary(data: SpatialData, typePrefix?: number): Buffer {
  const id = encodeDeviceId(data.deviceId);
  const base = typePrefix === undefined ? 0 : 1;
  const buf = Buffer.allocUnsafe(base + 24 + (id.length ? 1 + id.length : 0));
  if (typePrefix !== undefined) buf.writeUInt8(typePrefix, 0);
  buf.writeDoubleLE(Number.isFinite(data.timestamp) ? data.timestamp : 0, base);
  buf.writeInt16LE(clampInt16(data.translation.x), base + 8);
  buf.writeInt16LE(clampInt16(data.translation.y), base + 10);
  buf.writeInt16LE(clampInt16(data.translation.z), base + 12);
  buf.writeInt16LE(clampInt16(data.rotation.x), base + 14);
  buf.writeInt16LE(clampInt16(data.rotation.y), base + 16);
  buf.writeInt16LE(clampInt16(data.rotation.z), base + 18);
  buf.writeUInt32LE(0, base + 20); // buttons are sent separately
  if (id.length) {
    buf.writeUInt8(id.length, base + 24);
    id.copy(buf, base + 25);
  }
  return buf;
}
