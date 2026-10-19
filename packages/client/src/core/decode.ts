import type { SpatialData, ButtonEvent } from "./types.js";

const utf8 = new TextDecoder();

/**
 * Decode a binary spatial frame (WebTransport datagram or WebSocket binary
 * payload): 24 bytes, then optionally a 1-byte length and the UTF-8 source
 * device ID, which per-device settings need. Bridges before 0.19.0 send no ID.
 */
export function decodeBinaryFrame(buffer: ArrayBuffer | Uint8Array): SpatialData {
  const len = buffer.byteLength;
  if (len < 20) {
    throw new RangeError(`Spatial frame too short: expected ≥20 bytes, got ${len}`);
  }
  const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
  const offset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const view = new DataView(ab, offset, len);
  const idLength = len > 24 ? view.getUint8(24) : 0;
  const deviceId = idLength > 0 && 25 + idLength <= len
    ? utf8.decode(new Uint8Array(ab, offset + 25, idLength))
    : undefined;
  return {
    translation: {
      x: view.getInt16(8, true),
      y: view.getInt16(10, true),
      z: view.getInt16(12, true),
    },
    rotation: {
      x: view.getInt16(14, true),
      y: view.getInt16(16, true),
      z: view.getInt16(18, true),
    },
    timestamp: view.getFloat64(0, true),
    ...(deviceId && { deviceId }),
  };
}

/** Decode WebSocket binary frame (1-byte type prefix + spatial frame or JSON button event) */
export function decodeWsBinaryFrame(
  buffer: ArrayBuffer | Uint8Array,
): { type: "spatialData"; data: SpatialData } | { type: "buttonEvent"; data: ButtonEvent } | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 1) return null;

  const typePrefix = bytes[0];
  if (typePrefix === 0x01 && bytes.length >= 25) {
    return { type: "spatialData", data: decodeBinaryFrame(bytes.subarray(1)) };
  }
  if (typePrefix === 0x02) {
    const json = new TextDecoder().decode(bytes.subarray(1));
    return { type: "buttonEvent", data: JSON.parse(json) as ButtonEvent };
  }
  return null;
}

/** Decode length-prefixed JSON button events from a WebTransport stream chunk */
export function decodeButtonStream(
  buffer: Uint8Array<ArrayBufferLike>,
): { events: ButtonEvent[]; remainder: Uint8Array<ArrayBufferLike> } {
  const events: ButtonEvent[] = [];
  let pos = 0;

  while (pos + 4 <= buffer.length) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + pos);
    const len = view.getUint32(0, true);
    // Guard against absurd lengths
    if (len > 65536 || pos + 4 + len > buffer.length) break;
    const json = new TextDecoder().decode(buffer.subarray(pos + 4, pos + 4 + len));
    try {
      const event = JSON.parse(json);
      if (typeof event.button === "number" && typeof event.pressed === "boolean") {
        events.push(event as ButtonEvent);
      }
    } catch {
      // Skip malformed JSON frames
    }
    pos += 4 + len;
  }

  return { events, remainder: buffer.subarray(pos) };
}
