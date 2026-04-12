import { resolve } from "node:path";

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

export function loadConfig(): SatMouseConfig {
  return {
    wtPort: parsePort(process.env.SATMOUSE_WT_PORT, 18946),
    wsPort: parsePort(process.env.SATMOUSE_WS_PORT, 18945),
    host: process.env.SATMOUSE_HOST ?? "127.0.0.1",
    certsDir: resolve(process.env.SATMOUSE_CERTS_DIR ?? "./certs"),
    serviceName: process.env.SATMOUSE_SERVICE_NAME ?? "SatMouse",
    enabledPlugins: process.env.SATMOUSE_PLUGINS?.split(",") ?? [],
  };
}
