# @kelnishi/satmouse-client

Client SDK for [SatMouse](https://kelnishi.github.io/SatMouse/) — stream 6DOF spatial input from SpaceMouse and other devices to web apps and PWAs.

Four tree-shakeable modules:

| Module | Import | Purpose |
|---|---|---|
| **core** | `@kelnishi/satmouse-client` | `SatMouseConnection`, discovery, binary decode. Zero dependencies. |
| **utils** | `@kelnishi/satmouse-client/utils` | `InputManager` — per-device axis routing, scale, button-to-key mapping, persistence. |
| **react** | `@kelnishi/satmouse-client/react` | `<SatMouseProvider>`, `useSpatialData()`, `useButtonEvent()`, components. |
| **elements** | `@kelnishi/satmouse-client/elements` | Web Components: `<satmouse-status>`, `<satmouse-devices>`, `<satmouse-debug>`. |

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
  console.log(data.translation, data.rotation, data.w);
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
  // data.translation.x/y/z, data.rotation.x/y/z, data.w
}
```

### Web Components

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

## Configuration

### Device class defaults

Set routes, scales, and behavior by device class — applies to all devices of that type:

```typescript
const manager = new InputManager({
  translateScale: 0.001,
  rotateScale: 0.001,
  deviceClasses: {
    spacemouse: {
      // Built-in default: flips Y/Z axes (3Dconnexion convention)
      rotateScale: 0.0005,
    },
    gamepad: {
      routes: [
        { source: "tx", target: "tx" },
        { source: "tz", target: "tz" },
        { source: "rx", target: "rx" },
        { source: "rz", target: "rz" },
        { source: "ty", target: "ty" },           // L2 trigger
        { source: "ry", target: "ty", flip: true }, // R2 trigger (push-pull)
      ],
      deadZone: 0.05,
    },
  },
});
```

Device classes: `"spacemouse"`, `"gamepad"`, `"dial"`, `"joystick"`, `"6dof"`, `"other"`

### Per-device overrides

Override config for a specific device by ID or vendor pattern:

```typescript
const manager = new InputManager({
  devices: {
    // All PlayStation controllers (vendor 054c)
    "hid-54c-*": { translateScale: 0.002 },
    // A specific device by ID
    "hid-54c-9cc-1": { dominant: true },
  },
});

// Update at runtime
manager.updateDeviceConfig("cnx-c635", { translateScale: 0.0005 });
```

### Resolution order

Config is resolved per-device in this priority:

1. **Exact device ID** — `devices["hid-54c-9cc-1"]`
2. **ID pattern** — `devices["hid-54c-*"]`
3. **Device class** — `deviceClasses["gamepad"]`
4. **Device axes metadata** — auto-generated passthrough from bridge
5. **Global defaults** — `routes`, `translateScale`, etc.

## Button-to-Key Mapping

Map device buttons to keyboard events:

```typescript
manager.updateDeviceConfig("hid-054c-*", {
  buttonRoutes: [
    { button: 1, key: " ", code: "Space" },     // Cross → Space
    { button: 2, key: "Escape", code: "Escape" }, // Circle → Escape
  ],
});

// Button presses dispatch KeyboardEvent on document
// Also available as raw events:
manager.onButtonEvent((event) => {
  console.log(`Button ${event.button} ${event.pressed ? "pressed" : "released"}`);
});
```

## Connection Options

```typescript
// Auto-discover via Thing Description (default: localhost:18945)
new SatMouseConnection();

// Direct URL
new SatMouseConnection({ wsUrl: "ws://192.168.1.42:18945/spatial" });

// Via satmouse:// URI
new SatMouseConnection({ uri: "satmouse://connect?host=192.168.1.42" });
```

## License

MIT — [GitHub](https://github.com/kelnishi/SatMouse)
