# SatMouse Discovery & Handshake

## Overview

SatMouse uses a zero-configuration discovery flow built on mDNS and W3C Web of
Things (WoT) Thing Descriptions. No manual IP entry or port configuration
needed for clients on the same local network.

## Flow

```
  Client (e.g., Kelcite)                 SatMouse Bridge
  ──────────────────────                 ────────────────
         │                                      │
         │  1. Browse _wot._tcp via mDNS        │
         │ ◄────────────────────────────────────│ mDNS broadcast
         │                                      │
         │  2. Resolve → 192.168.1.42:18945      │
         │      TXT: td=/td.json                │
         │                                      │
         │  3. GET http://192.168.1.42:18945/td.json
         │ ────────────────────────────────────►│
         │                                      │
         │  4. 200 OK (Thing Description)       │
         │ ◄────────────────────────────────────│
         │                                      │
         │  5. Parse TD, read event forms       │
         │     → WebTransport: https://:18946    │
         │     → WebSocket:    ws://:18945       │
         │                                      │
         │  6a. new WebTransport(url, {         │
         │        serverCertificateHashes: [...] │
         │      })                              │
         │ ────────────────────────────────────►│ (preferred)
         │                                      │
         │  6b. new WebSocket(url)              │
         │ ────────────────────────────────────►│ (fallback)
         │                                      │
         │  7. Receive spatial data stream      │
         │ ◄════════════════════════════════════│
         │                                      │
```

## Step 1: mDNS Broadcast

SatMouse publishes a `_wot._tcp` service via mDNS (Bonjour/Avahi/mDNS):

| Field      | Value                          |
|------------|--------------------------------|
| Name       | `SatMouse`                     |
| Type       | `_wot._tcp`                    |
| Port       | `4444` (HTTP/WS server)        |
| TXT `td`   | `/td.json`                     |
| TXT `wt`   | `4443` (WebTransport port)     |
| TXT `type` | `SpatialInput`                 |

## Step 2: Client Discovery

Clients browse for `_wot._tcp` services using their platform's mDNS API:

- **Browser**: Not directly available. Use a companion library or manual entry.
- **Node.js**: `bonjour-service` or `mdns`
- **Native**: `NSNetServiceBrowser` (macOS), `NsdManager` (Android), Avahi (Linux)

The resolved service provides the bridge's IP address, HTTP port, and TXT
records pointing to the Thing Description path.

## Step 3: Fetch Thing Description

```
GET /td.json HTTP/1.1
Host: 192.168.1.42:18945
Accept: application/td+json
```

The response is a W3C WoT Thing Description (JSON-LD) describing:
- Device properties (info, connection status)
- Events (spatialData, buttonEvent) with forms listing all available endpoints
- Security definitions
- TLS certificate hash (for WebTransport `serverCertificateHashes`)

## Step 4: Protocol Selection

The client reads the `forms` array on each event affordance. Each form
specifies a protocol (`subprotocol` field) and endpoint (`href`):

```json
{
  "href": "https://192.168.1.42:18946",
  "subprotocol": "webtransport",
  "contentType": "application/octet-stream"
}
```

**Selection logic:**
1. If `WebTransport` API is available → use the `webtransport` form (lower latency)
2. Otherwise → use the `websocket` form (broader compatibility)

## Step 5: Connect

### WebTransport

```js
const transport = new WebTransport(url, {
  serverCertificateHashes: [{
    algorithm: "sha-256",
    value: hashFromTD
  }]
});
await transport.ready;

// Spatial data via datagrams
const reader = transport.datagrams.readable.getReader();
while (true) {
  const { value } = await reader.read();
  const spatialData = decodeBinaryFrame(value); // 24-byte frame
}
```

### WebSocket

```js
const ws = new WebSocket(url, "satmouse-json");
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "spatialData") { /* ... */ }
  if (msg.type === "buttonEvent") { /* ... */ }
};
```

## Security Considerations

- **Local network only**: SatMouse binds to the machine's LAN interface.
  It does not expose services to the internet.
- **Self-signed TLS**: Required for WebTransport. The certificate hash is
  distributed via the Thing Description, enabling pinned trust without a CA.
- **No authentication**: MVP has no auth. Future versions may add token-based
  access via the WoT security definitions.
