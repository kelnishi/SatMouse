# @kelnishi/satmouse-client

Client SDK for [SatMouse](https://kelnishi.github.io/SatMouse/) — stream 6DOF spatial input from SpaceMouse and other devices to web apps and PWAs.

Three tree-shakeable modules:

| Module | Import | Purpose |
|---|---|---|
| **core** | `@kelnishi/satmouse-client` | Connection, discovery, binary decode. Zero dependencies. |
| **utils** | `@kelnishi/satmouse-client/utils` | InputManager, transforms, per-device config, action mapping, persistence |
| **react** | `@kelnishi/satmouse-client/react` | Provider, hooks, headless components |

## Quick Start

```bash
npm install @kelnishi/satmouse-client
```

### Vanilla

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

### React

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

## Per-Device Configuration

```typescript
const manager = new InputManager({
  sensitivity: { translation: 0.001, rotation: 0.001 },
  devices: {
    "hid-054c-*": { sensitivity: { translation: 0.002 } },
    "spacemouse-c635": { flip: { rz: false } },
  },
});

// Query devices and their resolved config
const devices = manager.getDevicesWithConfig();

// Update per-device
manager.updateDeviceConfig("spacemouse-c635", {
  sensitivity: { rotation: 0.005 },
});
```

## Action Mapping

Remap input axes to named actions. Default passes through 1:1.

```typescript
import { InputManager, swapActions, DEFAULT_ACTION_MAP } from "@kelnishi/satmouse-client/utils";

// Swap ty and tz
const manager = new InputManager({
  actionMap: swapActions(DEFAULT_ACTION_MAP, "ty", "tz"),
});

// Per-device remapping
manager.updateDeviceConfig("hid-054c-*", {
  actionMap: {
    tx: { source: "tx" },
    tz: { source: "ty", invert: true },
    ry: { source: "rx", scale: 2.0 },
  },
});

// Named action values
manager.onActionValues((values) => {
  scene.pan(values.tx, values.ty);
  scene.zoom(values.tz);
});
```

## Connection Options

```typescript
// Auto-discover via Thing Description
new SatMouseConnection();

// Direct URL
new SatMouseConnection({ wsUrl: "ws://192.168.1.42:18945/spatial" });

// Via satmouse:// URI
new SatMouseConnection({ uri: "satmouse://connect?host=192.168.1.42" });
```

## License

MIT — [GitHub](https://github.com/kelnishi/SatMouse)
