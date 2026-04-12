# SatMouse

[![CI](https://github.com/kelnishi/SatMouse/actions/workflows/ci.yml/badge.svg)](https://github.com/kelnishi/SatMouse/actions/workflows/ci.yml)
[![Build](https://github.com/kelnishi/SatMouse/actions/workflows/build.yml/badge.svg)](https://github.com/kelnishi/SatMouse/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/kelnishi/SatMouse?label=release)](https://github.com/kelnishi/SatMouse/releases/latest)
[![npm @kelnishi/satmouse-client](https://img.shields.io/npm/v/@kelnishi/satmouse-client?label=@kelnishi/satmouse-client)](https://www.npmjs.com/package/@kelnishi/satmouse-client)
[![npm @kelnishi/satmouse](https://img.shields.io/npm/v/@kelnishi/satmouse?label=@kelnishi/satmouse)](https://www.npmjs.com/package/@kelnishi/satmouse)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/kelnishi?label=sponsor)](https://github.com/sponsors/kelnishi)

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

On macOS, move `SatMouse.app` to `/Applications` or `~/Applications` before launching. Running from Downloads will fail due to macOS App Translocation. Double-click the app — a 🛰 icon appears in the menu bar. No dock icon, no terminal needed.

### Connect from your app

```bash
npm install @kelnishi/satmouse-client
```

```typescript
import { SatMouseConnection } from "@kelnishi/satmouse-client";
import { InputManager } from "@kelnishi/satmouse-client/utils";

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

With the bridge running, open http://localhost:18945/client/ — a Three.js demo with a 6DOF-controlled cube.

## How It Works

1. **Launch** — SatMouse detects connected spatial input devices via platform-specific plugins
2. **Broadcast** — Advertises `_wot._tcp` via mDNS with a WoT Thing Description
3. **Connect** — Clients fetch `/td.json`, pick WebTransport or WebSocket
4. **Stream** — 6DOF translation + rotation data flows at device rate (~60-120 Hz)

Clients can also connect via the `satmouse://` URL scheme:
- `satmouse://connect?host=192.168.1.42` — connect to a specific bridge
- `satmouse://launch` — launch the app (or open the download page if not installed)

## Compatible Hardware

### Built-in plugins

| Plugin | Devices | macOS | Windows | Linux |
|---|---|---|---|---|
| **SpaceMouse** | SpaceNavigator, SpaceMouse Pro/Wireless/Compact/Enterprise, SpacePilot | 3DconnexionClient.framework | 3DxWare SDK | libspnav |
| **SpaceFox** | SpaceFox, SpaceFox Wireless | 3DconnexionClient.framework | 3DxWare SDK | libspnav |
| **Orbion** | Orbion rotary dial | 3DconnexionClient.framework | 3DxWare SDK | libspnav |
| **CadMouse** | CadMouse Pro/Compact (buttons only) | 3DconnexionClient.framework | 3DxWare SDK | libspnav |
| **HID** | Space Mushroom, Xbox/PlayStation controllers, any USB HID | node-hid | node-hid | node-hid |

### Adding a hardware plugin

SatMouse has a plugin architecture so hardware vendors and community contributors can add support for new devices. Each plugin implements the [`DevicePlugin`](src/devices/types.ts) interface:

```typescript
import { DevicePlugin, type DeviceInfo, type SpatialData } from "./devices/types.js";

export class MyDevicePlugin extends DevicePlugin {
  readonly id = "my-device";
  readonly name = "My 6DOF Device";
  readonly supportedPlatforms: NodeJS.Platform[] = ["darwin", "win32", "linux"];

  async isAvailable(): Promise<boolean> {
    // Return true if the device SDK/driver is installed on this machine
  }

  async connect(): Promise<void> {
    // Open the device and start emitting events:
    //   this.emit("spatialData", { translation: {x,y,z}, rotation: {x,y,z}, timestamp })
    //   this.emit("buttonEvent", { button: 0, pressed: true, timestamp })
    //   this.emit("deviceConnected", deviceInfo)
    //   this.emit("deviceDisconnected", deviceInfo)
  }

  disconnect(): void {
    // Release device resources
  }

  getDevices(): DeviceInfo[] {
    // Return currently connected devices
  }
}
```

Then register it in [`src/main.ts`](src/main.ts):

```typescript
deviceManager.registerPlugin(new MyDevicePlugin());
```

#### Plugin structure

```
src/devices/plugins/my-device/
  index.ts          # Plugin class (implements DevicePlugin)
```

For devices that use a shared native SDK (like 3Dconnexion devices), you can also create a shared driver under `src/devices/drivers/` — see [`src/devices/drivers/connexion/`](src/devices/drivers/connexion/) for an example.

#### HID devices

For USB HID devices, you don't need to write a plugin — add a mapping profile to the existing HID plugin instead:

```typescript
import { HIDPlugin, type HIDDeviceMapping } from "./devices/plugins/hid/index.js";

const myMapping: HIDDeviceMapping = {
  name: "My Device",
  vendorId: 0x1234,
  productId: 0x5678,
  axes: [
    { sourceAxis: 0, target: "tx" },
    { sourceAxis: 1, target: "ty" },
    { sourceAxis: 2, target: "tz" },
    { sourceAxis: 3, target: "rx", invert: true },
    { sourceAxis: 4, target: "ry", deadZone: 0.05 },
    { sourceAxis: 5, target: "rz", scale: 2.0 },
  ],
  buttons: [
    { sourceButton: 0, targetButton: 0 },
    { sourceButton: 1, targetButton: 1 },
  ],
};

const hid = new HIDPlugin([myMapping]);
deviceManager.registerPlugin(hid);
```

#### Submitting a plugin

1. Fork the repo
2. Add your plugin under `src/devices/plugins/<name>/`
3. Register it in `src/main.ts`
4. Add your device to the compatibility table in this README
5. Open a PR

## Compatible Clients

<!-- ADD YOUR APP HERE — submit a PR adding a row to this table -->
| Client | Type | Integration | Status |
|---|---|---|---|
| [Kelcite](https://kelcite.app) | 3D modeling web app | `@kelnishi/satmouse-client/react` | Integrated |
| [Reference Client](http://localhost:18945/client/) | Three.js demo | Built into SatMouse | Included |

### Listing your app

If your app integrates SatMouse, submit a PR adding a row to the table above. Include:
- Link to your app
- Brief description
- Which SDK module you use (or "custom" if using the WebSocket/WebTransport protocol directly)

### Client SDK

**`@kelnishi/satmouse-client`** — four tree-shakeable modules:

| Module | Import | Purpose |
|---|---|---|
| **core** | `@kelnishi/satmouse-client` | `SatMouseConnection`, discovery (`fetchThingDescription`, `resolveEndpoints`), binary decode, `launchSatMouse()`. Zero dependencies. |
| **utils** | `@kelnishi/satmouse-client/utils` | `InputManager` — unified device service with per-device axis routing (flip, scale, remap), dead zone, dominant mode, multi-device merge, settings persistence. |
| **react** | `@kelnishi/satmouse-client/react` | `<SatMouseProvider>`, `useSpatialData()`, `useRawSpatialData()`, `useButtonEvent()`, `<ConnectionStatus>`, `<SettingsPanel>`, `<DeviceInfo>`, `<DebugPanel>` |
| **elements** | `@kelnishi/satmouse-client/elements` | Web Components: `<satmouse-status>`, `<satmouse-devices>`, `<satmouse-debug>`. Shadow DOM, works in any framework. |

#### Core

```typescript
import { SatMouseConnection } from "@kelnishi/satmouse-client";

const connection = new SatMouseConnection({
  // All optional — defaults to localhost:18945
  tdUrl: "http://localhost:18945/td.json",
  transports: ["webtransport", "websocket"],
  maxRetries: 3,
});

connection.on("spatialData", (data) => { /* SpatialData */ });
connection.on("buttonEvent", (data) => { /* ButtonEvent */ });
connection.on("stateChange", (state, protocol) => { /* "connected" | "disconnected" | ... */ });
connection.on("deviceStatus", (event, device) => { /* "connected" | "disconnected" */ });

await connection.connect();
```

#### InputManager

```typescript
import { InputManager } from "@kelnishi/satmouse-client/utils";

const manager = new InputManager({
  scale: 0.001,
  deadZone: 0,
  dominant: false,
  lockPosition: false,
  lockRotation: false,
  devices: {
    "cnx-*": {
      routes: [
        { source: "tx", target: "tx" },
        { source: "ty", target: "ty", flip: true },
        { source: "tz", target: "tz", flip: true },
        { source: "rx", target: "rx" },
        { source: "ry", target: "ry", flip: true },
        { source: "rz", target: "rz", flip: true },
      ],
    },
  },
});

manager.addConnection(connection);
manager.onSpatialData((data) => { /* processed, merged, transformed */ });
manager.onButtonEvent((event) => { /* button press/release */ });

// Per-device config at runtime
manager.updateDeviceConfig("cnx-c635", { scale: 0.0005 });
```

#### Web Components

```html
<script type="module">
  import { SatMouseConnection } from "@kelnishi/satmouse-client";
  import { InputManager } from "@kelnishi/satmouse-client/utils";
  import { registerSatMouse } from "@kelnishi/satmouse-client/elements";

  const connection = new SatMouseConnection();
  const manager = new InputManager();
  manager.addConnection(connection);
  registerSatMouse(manager);
  await connection.connect();
</script>

<satmouse-status></satmouse-status>
<satmouse-devices></satmouse-devices>
<satmouse-debug></satmouse-debug>
```

Any app that speaks WebSocket or WebTransport can connect to SatMouse directly — the client SDK is optional but provides typed APIs, auto-discovery, transforms, and framework integration out of the box.

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
| `http://localhost:18945/td.json` | HTTP | WoT Thing Description |
| `http://localhost:18945/client/` | HTTP | Reference web client |
| `ws://localhost:18945/spatial` | WebSocket | Spatial data stream (fallback) |
| `https://localhost:18946` | WebTransport | Spatial data stream (primary) |
| `http://localhost:18945/api/device` | HTTP | Connected device info |

## Specifications

- [WoT Thing Description](specs/td.json) — W3C Web of Things TD
- [AsyncAPI](specs/asyncapi.yaml) — AsyncAPI 3.0 event protocol
- [JSON Schemas](specs/schemas/) — Data payload schemas
- [Wire Protocol](docs/protocol.md) — Binary and JSON formats
- [Discovery](docs/discovery.md) — mDNS + WoT handshake flow

## License

MIT
