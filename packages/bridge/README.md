# @kelnishi/satmouse

Run [SatMouse](https://kelnishi.github.io/SatMouse/) — a 6DOF spatial input bridge that streams SpaceMouse, gamepad, and HID device data to web apps.

## Install & Run

```bash
npx @kelnishi/satmouse
```

Downloads the correct platform binary from [GitHub Releases](https://github.com/kelnishi/SatMouse/releases/latest) on first run.

## What It Does

SatMouse bridges spatial input devices to web apps over WebSocket and WebTransport:

1. Detects connected devices (SpaceMouse, gamepads, HID)
2. Broadcasts `_wot._tcp` via mDNS for zero-config discovery
3. Streams 6DOF data at device rate (~60-120 Hz)
4. Legacy compatibility on port 18944 (spacemouse-proxy protocol)

## Ports

| Port | Protocol | Purpose |
|---|---|---|
| 18944 | WebSocket | Legacy spacemouse-proxy compat |
| 18945 | HTTP + WebSocket | Thing Description, reference client, spatial stream |
| 18946 | WebTransport | Low-latency HTTP/3 QUIC datagrams |
| 18947 | HTTPS | Thing Description + client (for HTTPS pages) |

## Platforms

| Platform | Status |
|---|---|
| macOS (Apple Silicon) | .app bundle with menu bar icon |
| Linux (x64) | Standalone binary |
| Windows (x64) | Standalone binary |

## For Client Apps

Install the SDK to integrate spatial input into your app:

```bash
npm install @kelnishi/satmouse-client
```

See [@kelnishi/satmouse-client](https://www.npmjs.com/package/@kelnishi/satmouse-client) for API docs.

## License

MIT — [GitHub](https://github.com/kelnishi/SatMouse)
