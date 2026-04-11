# SatMouse

A bridge application that streams 6DOF spatial input device data to apps over the network. Zero-config discovery via mDNS and W3C Web of Things, with WebTransport (HTTP/3 QUIC) for low-latency streaming and WebSocket fallback.

![Architecture](docs/images/architecture.png)

## Quick Start

### Run the bridge

Download the latest release for your platform:

| Platform | Download |
|---|---|
| macOS (Apple Silicon) | [SatMouse.app](https://github.com/kelnishi/SatMouse/releases/latest) |
| Linux (x64) | [satmouse-linux-x64.tar.gz](https://github.com/kelnishi/SatMouse/releases/latest) |
| Windows (x64) | [satmouse-win32-x64.tar.gz](https://github.com/kelnishi/SatMouse/releases/latest) |

Or install via npm:

```bash
npx @kelnishi/satmouse
```

On macOS, double-click `SatMouse.app` — a 🛰 icon appears in the menu bar. No dock icon, no terminal needed.

### Connect from your app

```bash
npm install @kelnishi/satmouse-client
```

```typescript
import { SatMouseConnection } from "@kelnishi/satmouse-client";
import { InputManager } from "@kelnishi/satmouse-client/utils";

// Connect (auto-discovers via td.json)
const connection = new SatMouseConnection();
const manager = new InputManager();
manager.addConnection(connection);

manager.onSpatialData((data) => {
  console.log(data.translation, data.rotation);
});

await connection.connect();
```

Or with React:

```tsx
import { SatMouseProvider, useSpatialData } from "@kelnishi/satmouse-client/react";

function App() {
  return (
    <SatMouseProvider>
      <Scene />
    </SatMouseProvider>
  );
}

function Scene() {
  const data = useSpatialData();
  // data.translation.x/y/z, data.rotation.x/y/z
}
```

### Try the reference client

With the bridge running, open http://localhost:4444/client/ — a Three.js demo with a 6DOF-controlled cube.

## How It Works

1. **Launch** — SatMouse detects connected spatial input devices via platform-specific plugins
2. **Broadcast** — Advertises `_wot._tcp` via mDNS with a WoT Thing Description
3. **Connect** — Clients fetch `/td.json`, pick WebTransport or WebSocket
4. **Stream** — 6DOF translation + rotation data flows at device rate (~60-120 Hz)

Clients can also connect via the `satmouse://` URL scheme:
- `satmouse://connect?host=192.168.1.42` — connect to a specific bridge
- `satmouse://launch` — launch the app (or open the download page if not installed)

## Client SDK

**`@kelnishi/satmouse-client`** — three tree-shakeable modules:

| Module | Import | Purpose |
|---|---|---|
| **core** | `@kelnishi/satmouse-client` | Connection, discovery, binary decode. Zero dependencies. |
| **utils** | `@kelnishi/satmouse-client/utils` | InputManager, transforms (flip, sensitivity, dominant, dead zone, axis remap), settings persistence |
| **react** | `@kelnishi/satmouse-client/react` | `<SatMouseProvider>`, `useSpatialData()`, `<SettingsPanel>`, `<DeviceInfo>`, `<DebugPanel>` |

## Supported Plugins

### 3Dconnexion SpaceMouse (built-in)

| Platform | SDK | Status |
|---|---|---|
| macOS | 3DconnexionClient.framework | Working |
| Windows | 3DxWare SDK | Planned |
| Linux | libspnav | Planned |

Supports SpaceNavigator, SpaceMouse Pro, SpaceMouse Wireless, SpaceMouse Compact, SpaceMouse Enterprise, and other 3Dconnexion devices.

### Adding device plugins

SatMouse has a plugin architecture for device support. Each plugin implements the `DevicePlugin` interface and is registered in `main.ts`:

```typescript
deviceManager.registerPlugin(new MyDevicePlugin());
```

See `src/devices/plugins/spacemouse/` for the reference implementation.

## Development

```bash
# Install dependencies
npm install

# Generate dev TLS certs (required for WebTransport)
npm run generate-certs

# Run in development mode
npm run dev

# Build client bundle
npm run build:client
```

## Endpoints

| Endpoint | Protocol | Purpose |
|---|---|---|
| `http://localhost:4444/td.json` | HTTP | WoT Thing Description |
| `http://localhost:4444/client/` | HTTP | Reference web client |
| `ws://localhost:4444/spatial` | WebSocket | Spatial data stream (fallback) |
| `https://localhost:4443` | WebTransport | Spatial data stream (primary) |
| `http://localhost:4444/api/device` | HTTP | Connected device info |

## Specifications

- [WoT Thing Description](specs/td.json) — W3C Web of Things TD
- [AsyncAPI](specs/asyncapi.yaml) — AsyncAPI 3.0 event protocol
- [JSON Schemas](specs/schemas/) — Data payload schemas
- [Wire Protocol](docs/protocol.md) — Binary and JSON formats
- [Discovery](docs/discovery.md) — mDNS + WoT handshake flow

## License

MIT
