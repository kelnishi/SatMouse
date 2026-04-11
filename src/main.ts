import { loadConfig } from "./config.js";
import { DeviceManager } from "./devices/manager.js";
import { SpaceMousePlugin } from "./devices/plugins/spacemouse/index.js";
import { TransportManager } from "./transport/index.js";
import { MDNSAdvertiser } from "./discovery/mdns.js";
import { TDServer } from "./discovery/td-server.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("SatMouse v0.1.0 — 3D Spatial Input Bridge");
  console.log("──────────────────────────────────────────");

  // 1. Set up device manager and register plugins
  const deviceManager = new DeviceManager();
  deviceManager.registerPlugin(new SpaceMousePlugin());
  // Future: deviceManager.registerPlugin(new OrbionPlugin());

  // 2. Start device connections
  await deviceManager.start(
    config.enabledPlugins.length ? config.enabledPlugins : undefined
  );

  const devices = deviceManager.getConnectedDevices();
  console.log(`\nDevices: ${devices.length ? devices.map((d) => d.name).join(", ") : "(none connected)"}`);

  // 3. Start HTTP server (serves td.json and reference client)
  const tdServer = new TDServer(config, deviceManager);
  const httpServer = tdServer.start();

  // 4. Start transport servers (WebTransport + WebSocket)
  const transportManager = new TransportManager(config);
  await transportManager.start(deviceManager, httpServer);

  // 5. Start mDNS advertisement
  const mdns = new MDNSAdvertiser(config);
  mdns.start();

  console.log("\n──────────────────────────────────────────");
  console.log(`Thing Description: http://localhost:${config.wsPort}/td.json`);
  console.log(`Reference client:  http://localhost:${config.wsPort}/client/`);
  console.log(`WebSocket:         ws://localhost:${config.wsPort}/spatial`);
  console.log(`WebTransport:      https://localhost:${config.wtPort}`);
  console.log("──────────────────────────────────────────\n");

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    mdns.stop();
    transportManager.stop();
    tdServer.stop();
    deviceManager.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
