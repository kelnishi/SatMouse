import { resolve, join } from "node:path";
import { homedir } from "node:os";

export interface SatMouseConfig {
  /** WebTransport server port (HTTP/3 QUIC) */
  wtPort: number;

  /** WebSocket / HTTP server port */
  wsPort: number;

  /** Host to bind to. Default: 127.0.0.1 (localhost only). Set to 0.0.0.0 for network access. */
  host: string;

  /** Directory for TLS certificates */
  certsDir: string;

  /** mDNS service name */
  serviceName: string;

  /** Enabled plugin IDs (empty = all available) */
  enabledPlugins: string[];
}

function parsePort(value: string | undefined, defaultPort: number): number {
  const port = parseInt(value ?? String(defaultPort), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function defaultCertsDir(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "SatMouse", "certs");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "SatMouse", "certs");
  }
  // Linux: XDG_DATA_HOME or ~/.local/share
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "SatMouse", "certs");
}

export function loadConfig(): SatMouseConfig {
  return {
    wtPort: parsePort(process.env.SATMOUSE_WT_PORT, 18946),
    wsPort: parsePort(process.env.SATMOUSE_WS_PORT, 18945),
    host: process.env.SATMOUSE_HOST ?? "0.0.0.0",
    certsDir: resolve(process.env.SATMOUSE_CERTS_DIR ?? defaultCertsDir()),
    serviceName: process.env.SATMOUSE_SERVICE_NAME ?? "SatMouse",
    enabledPlugins: process.env.SATMOUSE_PLUGINS?.split(",") ?? [],
  };
}
