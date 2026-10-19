# SatMouse Wire Protocol

## Overview

SatMouse streams spatial input data over two transport protocols:

- **WebTransport** (primary): HTTP/3 over QUIC. Lowest latency. Binary datagrams.
- **WebSocket** (fallback): HTTP/1.1 upgrade. JSON or binary frames.

Clients negotiate the protocol by reading the WoT Thing Description (`td.json`),
which lists available endpoints and encodings in each event's `forms` array.

## Data Types

### SpatialData

High-frequency 6DOF frame: 3 translation axes + 3 rotation axes + timestamp.
Sent at device polling rate (typically 60-120 Hz).

### ButtonEvent

Discrete button press/release events. Derived from diffing consecutive button
bitmask states. Sent reliably (not as datagrams).

## WebTransport Binary Format

Spatial data is sent as **datagrams** (unreliable, unordered). This is ideal
because each frame is self-contained and the latest value always supersedes
previous ones. A dropped frame is simply replaced by the next.

### Datagram Layout (24 bytes)

```
Offset  Size   Type       Field
──────  ────   ────       ─────
0       8      float64    timestamp (microseconds, LE)
8       2      int16      translation.x (LE)
10      2      int16      translation.y (LE)
12      2      int16      translation.z (LE)
14      2      int16      rotation.x (LE)
16      2      int16      rotation.y (LE)
18      2      int16      rotation.z (LE)
20      4      uint32     buttons bitmask (LE)
24      1      uint8      device ID length N (optional)
25      N      UTF-8      device ID (optional)
──────  ────
Total   24 bytes, or 25 + N with the device ID
```

- **timestamp**: `performance.now() * 1000` at capture time.
- **translation/rotation**: Device-native int16 values (typically -350 to 350
  for SpaceMouse). The range depends on the device and driver settings.
- **buttons**: Bitmask of all button states. Bit N = 1 means button N is pressed.
- **device ID**: The source device (`cnx-c635`, `hid-054c-5c4`), which clients
  need to apply per-device axis routes and scales. Bridges before 0.19.0 send
  only the first 24 bytes, and clients written for that format ignore the rest.

This matches the `ConnexionDeviceState` struct from the 3DConnexion SDK,
enabling zero-copy encoding on macOS.

### Button Events (Reliable Stream)

Button events are sent on a **unidirectional stream** (reliable, ordered).
Each event is a length-prefixed JSON object:

```
[4 bytes: uint32 LE length][N bytes: UTF-8 JSON]
```

JSON payload:
```json
{
  "button": 0,
  "pressed": true,
  "timestamp": 1234567890.123
}
```

## WebSocket Format

WebSocket supports two subprotocols, negotiated via `Sec-WebSocket-Protocol`:

### `satmouse-binary`

Same binary frames as WebTransport datagrams, device ID included.
Button events are separate binary messages with a 1-byte type prefix:
- `0x01` + spatial data frame
- `0x02` + JSON button event

### `satmouse-json` (default)

All messages are JSON text frames:

```json
{
  "type": "spatialData",
  "data": {
    "translation": { "x": 0, "y": 0, "z": 0 },
    "rotation": { "x": 0, "y": 0, "z": 0 },
    "timestamp": 1234567890.123
  }
}
```

```json
{
  "type": "buttonEvent",
  "data": {
    "button": 0,
    "pressed": true,
    "timestamp": 1234567890.123
  }
}
```

## Client → Bridge: Focus Reports

The bridge streams to clients and accepts one message type back: a report of
whether the client's page has input focus. Some device servers send input only
to a focused application, and the bridge is never the foreground application
itself, so it relays its clients' focus instead.

```json
{ "type": "focus", "focused": true }
```

| Transport | Framing |
|---|---|
| WebSocket | JSON text frame, on either subprotocol |
| WebTransport | Client-opened unidirectional stream carrying one `[uint32 LE length][UTF-8 JSON]` frame |
| Safari extension | `postMessage({ target: "satmouse-extension", action: "focus", focused })`; the background script relays the OR of its tabs over its WebSocket |

Rules:

- A client sends its state on connect and on every change. `focused` is true
  while `document.hasFocus()` and the page is visible.
- The bridge is focused while **any** connected client reports `true`. A
  client's report is discarded when it disconnects.
- Reports are accepted only from loopback peers. A page on another machine
  having focus says nothing about this machine's foreground application.
- Payload: `specs/schemas/focus-report.schema.json`.

## Backpressure

If a client cannot keep up with the spatial data rate:

- **WebTransport datagrams**: Automatically dropped by QUIC. No server-side
  buffering needed.
- **WebSocket**: The server maintains a single-slot buffer per client. If a
  frame hasn't been sent before the next arrives, the older frame is dropped.
  The client always receives the latest state.

## TLS

WebTransport requires TLS. SatMouse generates a self-signed certificate on
first run and stores it in `certs/`. The certificate's SHA-256 hash is included
in the Thing Description so clients can use `serverCertificateHashes` for
verification without a CA.
