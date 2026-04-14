import { loadConfig } from "./config.js";
import { DeviceManager } from "./devices/manager.js";
import { SpaceMousePlugin } from "./devices/plugins/spacemouse/index.js";
import { OrbionPlugin } from "./devices/plugins/orbion/index.js";
import { CadMousePlugin } from "./devices/plugins/cadmouse/index.js";
import { SpaceFoxPlugin } from "./devices/plugins/spacefox/index.js";
import { HIDPlugin } from "./devices/plugins/hid/index.js";
import { TransportManager } from "./transport/index.js";
import { MDNSAdvertiser } from "./discovery/mdns.js";
import { TDServer } from "./discovery/td-server.js";
import { createTray } from "./tray/index.js";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveResource } from "./resources.js";
import { ensureNSApp } from "./nsapp.js";
import { ensureCerts } from "./certs.js";

const isChildProcess = !!process.env.SATMOUSE_CHILD;
const noDevice = !!process.env.SATMOUSE_NO_DEVICE;
const skipConnexion = !!process.env.SATMOUSE_SKIP_CONNEXION;

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolveResource("package.json"), "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const version = getVersion();

  // Bootstrap NSApplication before anything else on macOS
  // Required for tray icon (dev mode) and 3Dconnexion framework (always)
  // Bootstrap NSApp for 3Dconnexion (not needed when Swift handles it)
  if (process.platform === "darwin" && !skipConnexion) ensureNSApp();

  // Generate TLS certs if missing (for WebTransport)
  ensureCerts(config.certsDir);

  console.log(`SatMouse v${version} — 6DOF Spatial Input Bridge`);
  console.log("──────────────────────────────────────────");

  const httpsPort = config.wsPort + 2;
  const clientUrl = `http://127.0.0.1:${config.wsPort}/client/`;
  const shutdown = () => {
    console.log("\nShutting down...");
    mdns.stop();
    transportManager.stop();
    tdServer.stop();
    deviceManager.stop();
    process.exit(0);
  };

  // Device manager
  const deviceManager = new DeviceManager();
  deviceManager.on("error", (err) => {
    console.error(`[DeviceManager] ${err.message}`);
  });

  // Tray: child process skips (tray-wrapper handles it).
  // Dev mode creates tray in-process.
  if (!isChildProcess) {
    const tray = await createTray();
    tray?.start({
      onOpenClient: () => openBrowser(clientUrl),
      onRescanDevices: async () => {
        console.log("[DeviceManager] Rescanning devices...");
        await deviceManager.rescan(
          config.enabledPlugins.length ? config.enabledPlugins : undefined
        );
        const devices = deviceManager.getConnectedDevices();
        console.log(`[DeviceManager] Devices: ${devices.length ? devices.map((d) => d.name).join(", ") : "(none)"}`);
      },
      onQuit: shutdown,
    });
  }

  if (!noDevice) {
    // Skip 3Dconnexion plugins when Swift app handles them (SATMOUSE_SKIP_CONNEXION)
    if (!skipConnexion) {
      deviceManager.registerPlugin(new SpaceMousePlugin());
      deviceManager.registerPlugin(new SpaceFoxPlugin());
      deviceManager.registerPlugin(new OrbionPlugin());
      deviceManager.registerPlugin(new CadMousePlugin());
    }
    deviceManager.registerPlugin(new HIDPlugin());

    await deviceManager.start(
      config.enabledPlugins.length ? config.enabledPlugins : undefined
    );

    const devices = deviceManager.getConnectedDevices();
    console.log(`\nDevices: ${devices.length ? devices.map((d) => d.name).join(", ") : "(none connected)"}`);
  } else {
    console.log("\nDevices: skipped (SATMOUSE_NO_DEVICE)");
  }

  // Read 3Dconnexion events from Swift parent via stdin (newline-delimited JSON)
  if (skipConnexion && process.stdin.readable) {
    const { buildDeviceInfo } = await import("./devices/drivers/connexion/products.js");
    const { createInterface } = await import("node:readline");
    let prevButtons = 0;
    const rl = createInterface({ input: process.stdin });
    rl.on("line", (line: string) => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "spatialData" && msg.data) {
          deviceManager.emit("spatialData", msg.data);
        } else if (msg.type === "buttonState" && msg.data) {
          const buttons: number = msg.data.buttons ?? 0;
          const ts = performance.now() * 1000;
          for (let i = 0; i < 32; i++) {
            const mask = 1 << i;
            if ((buttons & mask) !== (prevButtons & mask)) {
              deviceManager.emit("buttonEvent", {
                button: i,
                pressed: (buttons & mask) !== 0,
                timestamp: ts,
              });
            }
          }
          prevButtons = buttons;
        } else if (msg.type === "deviceAdded" && msg.data) {
          const info = buildDeviceInfo(msg.data.productId, msg.data.deviceId);
          deviceManager.emit("deviceConnected", info);
          console.log(`[3Dconnexion/Swift] Device added: ${info.model}`);
        } else if (msg.type === "deviceRemoved" && msg.data) {
          deviceManager.emit("deviceDisconnected", {
            id: msg.data.deviceId, name: "SpaceMouse", model: "SpaceMouse",
            vendor: "3Dconnexion", vendorId: 0x046d, productId: 0,
            connectionType: "unknown" as const,
          });
        }
      } catch {
        // Drop malformed lines
      }
    });
    console.log("[3Dconnexion] Listening for events from Swift parent via stdin");
  }

  // HTTP server
  const tdServer = new TDServer(config, deviceManager);
  const httpServer = tdServer.start();

  // Transport servers
  const transportManager = new TransportManager(config);
  await transportManager.start(deviceManager, httpServer);

  // Wire client status for /api/status
  tdServer.getClients = () => transportManager.getClientInfo();

  // mDNS
  const mdns = new MDNSAdvertiser(config);
  mdns.start();

  console.log("\n──────────────────────────────────────────");
  console.log(`Legacy (compat):   ws://127.0.0.1:18944`);
  console.log(`Thing Description: http://localhost:${config.wsPort}/td.json`);
  console.log(`                   https://localhost:${httpsPort}/td.json`);
  console.log(`Reference client:  ${clientUrl}`);
  console.log(`WebSocket:         ws://localhost:${config.wsPort}/spatial`);
  console.log(`WebTransport:      https://localhost:${config.wtPort}`);
  console.log("──────────────────────────────────────────\n");

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // SIGUSR1: rescan for new devices (triggered by tray "Rescan Devices" menu)
  if (!noDevice) {
    process.on("SIGUSR1", async () => {
      console.log("[DeviceManager] Rescanning devices...");
      await deviceManager.rescan(
        config.enabledPlugins.length ? config.enabledPlugins : undefined
      );
      const devices = deviceManager.getConnectedDevices();
      console.log(`[DeviceManager] Devices: ${devices.length ? devices.map((d) => d.name).join(", ") : "(none)"}`);
    });
  }
}

function openBrowser(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
  } catch { return; }

  switch (process.platform) {
    case "darwin":
      execFile("open", [url]);
      break;
    case "win32":
      execFile("cmd", ["/c", "start", "", url]);
      break;
    default:
      execFile("xdg-open", [url]);
      break;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
