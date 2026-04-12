import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import type { SatMouseConfig } from "../config.js";
import type { DeviceManager } from "../devices/manager.js";
import { resolveResource, isPathWithin } from "../resources.js";

/**
 * HTTP server that serves:
 * - GET /td.json — WoT Thing Description (populated with runtime host/port)
 * - GET /api/device — Current device info (JSON)
 * - GET /client/* — Reference web client (static files)
 */
export class TDServer {
  private server: Server | null = null;
  private config: SatMouseConfig;
  private deviceManager: DeviceManager;
  private certHashBase64: string | null = null;

  constructor(config: SatMouseConfig, deviceManager: DeviceManager) {
    this.config = config;
    this.deviceManager = deviceManager;

    // Compute cert hash for WebTransport serverCertificateHashes
    const certPath = join(config.certsDir, "cert.pem");
    if (existsSync(certPath)) {
      const pem = readFileSync(certPath, "utf-8");
      // Extract DER from PEM
      const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
      const der = Buffer.from(b64, "base64");
      const hash = createHash("sha256").update(der).digest("base64");
      this.certHashBase64 = hash;
      console.log(`[TDServer] Cert SHA-256: ${hash}`);
    }
  }

  start(): Server {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(this.config.wsPort, this.config.host, () => {
      console.log(`[HTTP] Serving td.json and client at http://${this.config.host}:${this.config.wsPort}`);
    });
    return this.server;
  }

  stop(): void {
    this.server?.close();
    console.log("[HTTP] Stopped");
  }

  private setCORS(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin ?? "";
    // Allow localhost origins on any port, reject others
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "/";
    this.setCORS(req, res);

    if (url === "/td.json") {
      this.serveTD(res);
    } else if (url === "/api/device") {
      this.serveDeviceInfo(res);
    } else if (url.startsWith("/client")) {
      this.serveClient(url, res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  }

  private serveTD(res: ServerResponse): void {
    const host = getLocalIP();
    const baseWt = `https://${host}:${this.config.wtPort}`;
    const baseWs = `ws://${host}:${this.config.wsPort}`;
    const baseHttp = `http://${host}:${this.config.wsPort}`;

    // Load the static TD template and populate with runtime values
    try {
      const tdPath = resolveResource("specs/td.json");
      const td = JSON.parse(readFileSync(tdPath, "utf-8"));

      // Update base URL references
      td.base = baseHttp;
      td.id = `urn:satmouse:bridge:${host}`;

      // Include cert hash for WebTransport serverCertificateHashes
      if (this.certHashBase64) {
        td["satmouse:certHash"] = this.certHashBase64;
      }

      // Advertise the satmouse:// connect URI
      td["satmouse:uri"] = `satmouse://connect?host=${host}&wsPort=${this.config.wsPort}&wtPort=${this.config.wtPort}`;

      // Update form hrefs with runtime addresses
      if (td.properties?.deviceInfo?.forms) {
        td.properties.deviceInfo.forms[0].href = `${baseHttp}/api/device`;
      }
      if (td.events?.spatialData?.forms) {
        td.events.spatialData.forms[0].href = baseWt;
        td.events.spatialData.forms[1].href = `${baseWs}/spatial`;
      }
      if (td.events?.buttonEvent?.forms) {
        td.events.buttonEvent.forms[0].href = baseWt;
        td.events.buttonEvent.forms[1].href = `${baseWs}/spatial`;
      }

      res.writeHead(200, {
        "Content-Type": "application/td+json",
      });
      res.end(JSON.stringify(td, null, 2));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Failed to load Thing Description");
    }
  }

  private serveDeviceInfo(res: ServerResponse): void {
    const devices = this.deviceManager.getConnectedDevices();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify({ devices }));
  }

  private serveClient(url: string, res: ServerResponse): void {
    // Map /client or /client/ to /client/index.html
    let relPath = url === "/client" || url === "/client/" ? "client/index.html" : url.slice(1);
    const filePath = resolveResource(relPath);

    // Prevent path traversal — verify resolved path is within client directory
    const clientDir = resolveResource("client");
    if (!isPathWithin(filePath, clientDir)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    try {
      const content = readFileSync(filePath);
      const ext = filePath.split(".").pop();
      const mimeTypes: Record<string, string> = {
        html: "text/html",
        js: "application/javascript",
        css: "text/css",
        json: "application/json",
      };
      res.writeHead(200, {
        "Content-Type": mimeTypes[ext ?? ""] ?? "application/octet-stream",
      });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  }
}

/** Get the first non-internal IPv4 address */
function getLocalIP(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}
