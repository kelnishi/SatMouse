# SatMouse

A 3DConnexion SpaceMouse bridge application. Streams 6DOF spatial input data over WebTransport and WebSocket, advertised via W3C Web of Things (WoT) Thing Descriptions and mDNS discovery.

## Architecture

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                        SatMouse (Node SEA)                          │
  │                                                                     │
  │  ┌─────────────────────────────────────────┐                        │
  │  │            Plugin Registry              │                        │
  │  │  ┌─────────────┐ ┌──────────────────┐   │                        │
  │  │  │ spacemouse   │ │ (future plugins) │   │                        │
  ��  │  │  ├─ macos    │ │ orbion, spacefox │   │                        │
  │  │  │  ├─ windows  │ │ cadmouse, hid    │   │                        │
  │  │  │  └─ linux    │ │     ...          │   │                        │
  │  │  └──────┬───────┘ └────────┬─────────┘   │                        ��
  │  └─────────┼──────────────────┼─────────────┘                        ���
  │            │  DevicePlugin    │                                      │
  │            ▼ interface        ▼              ┌──────────────────────┐│
  │  ┌───────────────────────────────────┐       │  Transport Server    ││
  │  │         Device Manager            │──────▶│  ┌────────────────┐ ││
  │  │  detects plugins, manages lifecycle│      │  │ WebTransport   │ │├──▶ Clients
  │  │  aggregates SpatialData + ButtonEvent│    │  │ (HTTP/3 QUIC)  │ ││
  │  └───────────────────────────────────┘       │  ├────────────────┤ ││
  │                                              │  │ WebSocket      │ │├──▶ Clients
  │                                              │  │ (fallback)     │ ││
  │  ┌───────────────────────────────────┐       │  └────────────────┘ ││
  │  │         Discovery Layer           │       └──────────────────────┘│
  │  │  mDNS (_wot._tcp) ←→ td.json     │                               │
  ���  └───────────────────────────────────┘                               │
  └─────────────────────────────────────────────────────────────────────┘
```

## Discovery Flow

1. **mDNS Broadcast**: SatMouse advertises `_wot._tcp` on the local network
2. **Discovery**: Client scans for `_wot._tcp` and resolves the IP
3. **Negotiation**: Client fetches `/td.json` (WoT Thing Description)
4. **Protocol Selection**: WebTransport if supported (lower latency), WebSocket fallback

See [docs/discovery.md](docs/discovery.md) for the full handshake flow.

## Quick Start

```bash
# Install dependencies
npm install

# Generate dev TLS certs (required for WebTransport)
npm run generate-certs

# Run in development mode
npm run dev
```

Open the reference client at `http://localhost:4444/client/`

## Endpoints

| Endpoint | Protocol | Purpose |
|---|---|---|
| `http://localhost:4444/td.json` | HTTP | WoT Thing Description |
| `http://localhost:4444/client/` | HTTP | Reference web client |
| `ws://localhost:4444/spatial` | WebSocket | Spatial data stream (fallback) |
| `https://localhost:4443` | WebTransport | Spatial data stream (primary) |

## Building

```bash
# Bundle TypeScript
npm run build

# Build single executable (Node SEA)
npm run build:sea
```

## Hardware Support

### Current
- **3DConnexion SpaceMouse** (macOS via 3DconnexionClient.framework)

### Planned
- 3DConnexion SpaceMouse (Windows via 3DxWare, Linux via libspnav)
- Additional spatial input devices via the plugin system

## Specifications

- [WoT Thing Description](specs/td.json) — W3C Web of Things TD
- [AsyncAPI](specs/asyncapi.yaml) — AsyncAPI 3.0 event protocol
- [JSON Schemas](specs/schemas/) — Data payload schemas
- [Wire Protocol](docs/protocol.md) — Binary and JSON formats
- [Discovery](docs/discovery.md) — mDNS + WoT handshake flow

## License

MIT
