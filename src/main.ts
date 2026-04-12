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
  ensureNSApp();

  // Generate TLS certs if missing (for WebTransport)
  ensureCerts(config.certsDir);

  console.log(`SatMouse v${version} — 6DOF Spatial Input Bridge`);
  console.log("──────────────────────────────────────────");

  // 1. Initialize system tray
  //    which the 3Dconnexion framework requires for event delivery.
  const clientUrl = `http://localhost:${config.wsPort}/client/`;
  const shutdown = () => {
    console.log("\nShutting down...");
    mdns.stop();
    transportManager.stop();
    tdServer.stop();
    deviceManager.stop();
    process.exit(0);
  };

  const tray = await createTray();
  tray?.start({
    onOpenClient: () => openBrowser(clientUrl),
    onQuit: shutdown,
  });

  // 2. Set up device manager and register plugins
  const deviceManager = new DeviceManager();
  deviceManager.registerPlugin(new SpaceMousePlugin());
  deviceManager.registerPlugin(new SpaceFoxPlugin());
  deviceManager.registerPlugin(new OrbionPlugin());
  deviceManager.registerPlugin(new CadMousePlugin());
  deviceManager.registerPlugin(new HIDPlugin());

  // 3. Start device connections (after tray/NSApp is initialized)
  await deviceManager.start(
    config.enabledPlugins.length ? config.enabledPlugins : undefined
  );

  const devices = deviceManager.getConnectedDevices();
  console.log(`\nDevices: ${devices.length ? devices.map((d) => d.name).join(", ") : "(none connected)"}`);

  // 4. Start HTTP server (serves td.json and reference client)
  const tdServer = new TDServer(config, deviceManager);
  const httpServer = tdServer.start();

  // 5. Start transport servers (WebTransport + WebSocket + Legacy)
  const transportManager = new TransportManager(config);
  await transportManager.start(deviceManager, httpServer);

  // 6. Start mDNS advertisement
  const mdns = new MDNSAdvertiser(config);
  mdns.start();

  console.log("\n──────────────────────────────────────────");
  console.log(`Legacy (compat):   ws://127.0.0.1:18944`);
  console.log(`Thing Description: http://localhost:${config.wsPort}/td.json`);
  console.log(`Reference client:  ${clientUrl}`);
  console.log(`WebSocket:         ws://localhost:${config.wsPort}/spatial`);
  console.log(`WebTransport:      https://localhost:${config.wtPort}`);
  console.log("──────────────────────────────────────────\n");

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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
