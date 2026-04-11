import type { SpatialData, ButtonEvent } from "./types.js";

/** Decode 24-byte binary spatial data datagram (WebTransport or raw binary) */
export function decodeBinaryFrame(buffer: ArrayBuffer | Uint8Array): SpatialData {
  const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
  const offset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const view = new DataView(ab, offset);
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
  };
}

/** Decode WebSocket binary frame (1-byte type prefix + 24-byte payload) */
export function decodeWsBinaryFrame(
  buffer: ArrayBuffer | Uint8Array,
): { type: "spatialData"; data: SpatialData } | { type: "buttonEvent"; data: ButtonEvent } | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 1) return null;

  const typePrefix = bytes[0];
  if (typePrefix === 0x01 && bytes.length >= 25) {
    return { type: "spatialData", data: decodeBinaryFrame(bytes.subarray(1, 25)) };
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
    if (pos + 4 + len > buffer.length) break;
    const json = new TextDecoder().decode(buffer.subarray(pos + 4, pos + 4 + len));
    events.push(JSON.parse(json) as ButtonEvent);
    pos += 4 + len;
  }

  return { events, remainder: buffer.subarray(pos) };
}
