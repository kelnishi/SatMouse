import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";

/** Browsers accept a certificate pinned through `serverCertificateHashes` only
 *  if its validity period is at most 14 days, so a longer one fails every
 *  WebTransport handshake and clients fall back to WebSocket. */
export const CERT_VALIDITY_DAYS = 13;
const MAX_VALIDITY_MS = 14 * 24 * 3600 * 1000;
/** Regenerate at startup when less than this remains. The servers read the
 *  certificate once, so this is the uptime a launch is guaranteed before
 *  WebTransport lapses to the WebSocket fallback. */
const MIN_REMAINING_MS = 7 * 24 * 3600 * 1000;

/** Why the existing certificate can't be pinned, or null if it can */
export function certProblem(certPem: string, now = Date.now()): string | null {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certPem);
  } catch {
    return "unreadable";
  }
  const from = Date.parse(cert.validFrom);
  const to = Date.parse(cert.validTo);
  if (to - from > MAX_VALIDITY_MS) return "valid for more than 14 days";
  if (to - now < MIN_REMAINING_MS) return "expires within 7 days";
  return null;
}

/**
 * Generate a self-signed TLS certificate for WebTransport and the HTTPS
 * Thing Description when none is usable. Clients pin it by the SHA-256 hash
 * published in the TD.
 */
export function ensureCerts(certsDir: string): void {
  const certPath = join(certsDir, "cert.pem");
  const keyPath = join(certsDir, "key.pem");

  if (existsSync(certPath) && existsSync(keyPath)) {
    const problem = certProblem(readFileSync(certPath, "utf-8"));
    if (!problem) return;
    console.log(`[Certs] Replacing certificate: ${problem}`);
  }

  mkdirSync(certsDir, { recursive: true });

  try {
    execFileSync("openssl", [
      "req", "-x509",
      "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
      "-keyout", keyPath,
      "-out", certPath,
      "-days", String(CERT_VALIDITY_DAYS),
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
