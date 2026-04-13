import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import type { SatMouseConfig } from "../config.js";
import type { DeviceManager } from "../devices/manager.js";
import { resolveResource, isPathWithin } from "../resources.js";

/**
 * HTTP + HTTPS server that serves:
 * - GET /td.json — WoT Thing Description (populated with runtime host/port)
 * - GET /api/device — Current device info (JSON)
 * - GET /client/* — Reference web client (static files)
 *
 * HTTPS uses the same self-signed certs as WebTransport. This allows
 * 3rd party HTTPS clients (like ghpages) to fetch the TD without
 * mixed-content blocks.
 */
export class TDServer {
  private httpServer: Server | null = null;
  private httpsServer: HttpsServer | null = null;
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
      const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
      const der = Buffer.from(b64, "base64");
      const hash = createHash("sha256").update(der).digest("base64");
      this.certHashBase64 = hash;
      console.log(`[TDServer] Cert SHA-256: ${hash}`);
    }
  }

  start(): Server {
    const handler = (req: IncomingMessage, res: ServerResponse) => this.handleRequest(req, res);

    // HTTP server
    this.httpServer = createServer(handler);
    this.httpServer.listen(this.config.wsPort, this.config.host, () => {
      console.log(`[HTTP] Serving td.json and client at http://${this.config.host}:${this.config.wsPort}`);
    });

    // HTTPS server (same handler, same certs as WebTransport)
    const certPath = join(this.config.certsDir, "cert.pem");
    const keyPath = join(this.config.certsDir, "key.pem");
    if (existsSync(certPath) && existsSync(keyPath)) {
      try {
        const tlsOptions = {
          cert: readFileSync(certPath),
          key: readFileSync(keyPath),
        };
        // HTTPS on wsPort + 2 (18947 by default) to avoid collision with WebTransport (18946)
        const httpsPort = this.config.wsPort + 2;
        this.httpsServer = createHttpsServer(tlsOptions, handler);
        this.httpsServer.listen(httpsPort, this.config.host, () => {
          console.log(`[HTTPS] Serving td.json and client at https://${this.config.host}:${httpsPort}`);
        });
        this.httpsServer.on("error", (err: any) => {
          if (err.code === "EADDRINUSE") {
            console.warn(`[HTTPS] Port ${httpsPort} in use, HTTPS disabled`);
          } else {
            console.warn("[HTTPS] Failed to start:", err.message);
          }
          this.httpsServer = null;
        });
      } catch (err) {
        console.warn("[HTTPS] Failed to start:", err);
      }
    }

    return this.httpServer;
  }

  stop(): void {
    this.httpServer?.close();
    this.httpsServer?.close();
    console.log("[HTTP] Stopped");
  }

  private setCORS(_req: IncomingMessage, res: ServerResponse): void {
    // Allow any origin — SatMouse is a local bridge, 3rd party HTTPS clients need access
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "/";
    this.setCORS(req, res);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url === "/td.json") {
      this.serveTD(req, res);
    } else if (url === "/api/device") {
      this.serveDeviceInfo(res);
    } else if (url.startsWith("/client")) {
      this.serveClient(url, res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  }

  private serveTD(req: IncomingMessage, res: ServerResponse): void {
    const reqHost = (req.headers.host ?? "localhost").split(":")[0];
    const host = reqHost;
    const baseWt = `https://${host}:${this.config.wtPort}`;
    const baseWs = `ws://${host}:${this.config.wsPort}`;
    const baseHttp = `http://${host}:${this.config.wsPort}`;

    try {
      const tdPath = resolveResource("specs/td.json");
      const td = JSON.parse(readFileSync(tdPath, "utf-8"));

      td.base = baseHttp;
      td.id = `urn:satmouse:bridge:${host}`;

      if (this.certHashBase64) {
        td["satmouse:certHash"] = this.certHashBase64;
      }

      td["satmouse:uri"] = `satmouse://connect?host=${host}&wsPort=${this.config.wsPort}&wtPort=${this.config.wtPort}`;

      if (td.properties?.deviceInfo?.forms) {
        td.properties.deviceInfo.forms[0].href = `${baseHttp}/api/device`;
      }
      if (td.events?.spatialData?.forms) {
        if (this.certHashBase64) {
          td.events.spatialData.forms[0].href = baseWt;
        } else {
          td.events.spatialData.forms = td.events.spatialData.forms.filter(
            (f: any) => f.subprotocol !== "webtransport"
          );
        }
        const wsForm = td.events.spatialData.forms.find((f: any) => f.subprotocol === "websocket");
        if (wsForm) wsForm.href = `${baseWs}/spatial`;
      }
      if (td.events?.buttonEvent?.forms) {
        if (this.certHashBase64) {
          td.events.buttonEvent.forms[0].href = baseWt;
        } else {
          td.events.buttonEvent.forms = td.events.buttonEvent.forms.filter(
            (f: any) => f.subprotocol !== "webtransport"
          );
        }
        const wsForm = td.events.buttonEvent.forms.find((f: any) => f.subprotocol === "websocket");
        if (wsForm) wsForm.href = `${baseWs}/spatial`;
      }

      res.writeHead(200, { "Content-Type": "application/td+json" });
      res.end(JSON.stringify(td, null, 2));
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Failed to load Thing Description");
    }
  }

  private serveDeviceInfo(res: ServerResponse): void {
    const devices = this.deviceManager.getConnectedDevices();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ devices }));
  }

  private serveClient(url: string, res: ServerResponse): void {
    let relPath = url === "/client" || url === "/client/" ? "client/index.html" : url.slice(1);
    const filePath = resolveResource(relPath);

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
        svg: "image/svg+xml",
        png: "image/png",
      };
      res.writeHead(200, { "Content-Type": mimeTypes[ext ?? ""] ?? "application/octet-stream" });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  }
}
