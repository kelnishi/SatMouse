import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";

/**
 * Generate self-signed TLS certificates for WebTransport if they don't exist.
 * Returns the SHA-256 hash of the certificate (base64) for serverCertificateHashes.
 */
export function ensureCerts(certsDir: string): void {
  const certPath = join(certsDir, "cert.pem");
  const keyPath = join(certsDir, "key.pem");

  if (existsSync(certPath) && existsSync(keyPath)) return;

  mkdirSync(certsDir, { recursive: true });

  try {
    execFileSync("openssl", [
      "req", "-x509",
      "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
      "-keyout", keyPath,
      "-out", certPath,
      "-days", "365",
      "-nodes",
      "-subj", "/CN=SatMouse",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ], { stdio: "pipe" });

    console.log(`[Certs] Generated self-signed certificate in ${certsDir}`);
  } catch (err) {
    console.warn("[Certs] Failed to generate TLS certificates (openssl not found?)");
    console.warn("  WebTransport will be unavailable. WebSocket still works.");
  }
}
