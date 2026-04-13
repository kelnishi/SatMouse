import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import type { SatMouseConfig } from "../config.js";
import type { DeviceManager } from "../devices/manager.js";
import type { WebRTCServer } from "../transport/webrtc.js";
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
  private _webrtc: WebRTCServer | null = null;

  /** Set the WebRTC server for signaling (called after transport manager starts) */
  set webrtcServer(rtc: WebRTCServer) {
    this._webrtc = rtc;
  }

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

  get httpsServerInstance(): HttpsServer | null {
    return this.httpsServer;
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

  private setCORS(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;

    // PNA (Private Network Access / Local Network Access) requires:
    // 1. Echo the specific requesting origin (no wildcard with PNA)
    // 2. Access-Control-Allow-Private-Network: true
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.setHeader("Vary", "Origin");
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "/";
    this.setCORS(req, res);

    // Handle CORS + PNA preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, version: process.env.npm_package_version ?? "unknown" }));
    } else if (url === "/td.json") {
      this.serveTD(req, res);
    } else if (url.startsWith("/negotiate")) {
      this.serveNegotiate(req, res);
    } else if (url === "/rtc/offer" && req.method === "POST") {
      this.serveRTCOffer(req, res);
    } else if (url.startsWith("/rtc/connect")) {
      this.serveRTCConnect(req, res);
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

  /**
   * Handle /negotiate — redirect back to the requesting origin with connection details.
   * Used by the URI scheme tunnel when direct fetch is blocked (Safari LNA).
   *
   * GET /negotiate?origin=https://kelcite.app&callback=/satmouse-handshake
   * → 302 https://kelcite.app/satmouse-handshake?ip=127.0.0.1&wsPort=18945&wtPort=18946&httpsPort=18947&certHash=...
   */
  private serveNegotiate(req: IncomingMessage, res: ServerResponse): void {
    const parsed = new URL(req.url ?? "/", "http://localhost");
    const origin = parsed.searchParams.get("origin");
    const callback = parsed.searchParams.get("callback") ?? "/satmouse-handshake";
    const challenge = parsed.searchParams.get("challenge") ?? "";

    if (!origin) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing origin parameter");
      return;
    }

    // Build redirect URL with connection details
    const params = new URLSearchParams({
      ip: "127.0.0.1",
      wsPort: String(this.config.wsPort),
      wtPort: String(this.config.wtPort),
      httpsPort: String(this.config.wsPort + 2),
      ...(this.certHashBase64 && { certHash: this.certHashBase64 }),
      ...(challenge && { challenge }),
    });

    const redirectUrl = `${origin}${callback}?${params}`;
    res.writeHead(302, { Location: redirectUrl });
    res.end();
  }

  /**
   * POST /rtc/offer — Direct SDP signaling for browsers that can POST to localhost.
   * Body: SDP offer string. Response: SDP answer string.
   */
  private serveRTCOffer(req: IncomingMessage, res: ServerResponse): void {
    if (!this._webrtc) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("WebRTC not available");
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", async () => {
      try {
        const answer = await this._webrtc!.handleOffer(body);
        res.writeHead(200, { "Content-Type": "application/sdp" });
        res.end(answer);
      } catch (err) {
        console.error("[WebRTC] Failed to handle offer:", err);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Failed to process offer");
      }
    });
  }

  /**
   * GET /rtc/connect — Navigate-redirect signaling for Safari.
   * Client navigates here with SDP offer as base64 query param.
   * Bridge processes offer, redirects back with SDP answer.
   *
   * GET /rtc/connect?offer=<base64>&origin=<origin>&callback=<path>
   * → 302 <origin><callback>?answer=<base64>
   */
  private serveRTCConnect(req: IncomingMessage, res: ServerResponse): void {
    if (!this._webrtc) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("WebRTC not available");
      return;
    }

    const parsed = new URL(req.url ?? "/", "http://localhost");
    const offerB64 = parsed.searchParams.get("offer");
    const origin = parsed.searchParams.get("origin");
    const callback = parsed.searchParams.get("callback") ?? "/";

    if (!offerB64 || !origin) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing offer or origin parameter");
      return;
    }

    const offerSdp = Buffer.from(offerB64, "base64").toString("utf-8");

    this._webrtc.handleOffer(offerSdp).then((answer) => {
      const answerB64 = Buffer.from(answer).toString("base64");
      const redirectUrl = `${origin}${callback}?answer=${encodeURIComponent(answerB64)}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
    }).catch((err) => {
      console.error("[WebRTC] Failed to handle offer:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Failed to process offer");
    });
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
