import { resolve } from "node:path";

export interface SatMouseConfig {
  /** WebTransport server port (HTTP/3 QUIC) */
  wtPort: number;

  /** WebSocket / HTTP server port */
  wsPort: number;

  /** Directory for TLS certificates */
  certsDir: string;

  /** mDNS service name */
  serviceName: string;

  /** Enabled plugin IDs (empty = all available) */
  enabledPlugins: string[];
}

export function loadConfig(): SatMouseConfig {
  return {
    wtPort: parseInt(process.env.SATMOUSE_WT_PORT ?? "4443", 10),
    wsPort: parseInt(process.env.SATMOUSE_WS_PORT ?? "4444", 10),
    certsDir: resolve(process.env.SATMOUSE_CERTS_DIR ?? "./certs"),
    serviceName: process.env.SATMOUSE_SERVICE_NAME ?? "SatMouse",
    enabledPlugins: process.env.SATMOUSE_PLUGINS?.split(",") ?? [],
  };
}
