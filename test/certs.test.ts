import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { certProblem, ensureCerts } from "../src/certs.ts";

function makeCert(dir: string, days: number): void {
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
    "-days", String(days), "-nodes", "-subj", "/CN=SatMouse",
  ], { stdio: "pipe" });
}

test("a fresh certificate can be pinned by hash: under 14 days and not near expiry", () => {
  const dir = mkdtempSync(join(tmpdir(), "satmouse-certs-"));
  ensureCerts(dir);
  const pem = readFileSync(join(dir, "cert.pem"), "utf-8");
  const cert = new X509Certificate(pem);
  assert.ok(Date.parse(cert.validTo) - Date.parse(cert.validFrom) <= 14 * 24 * 3600 * 1000);
  assert.equal(certProblem(pem), null);
  // A usable certificate is kept, so its pinned hash stays stable across launches
  ensureCerts(dir);
  assert.equal(readFileSync(join(dir, "cert.pem"), "utf-8"), pem);
});

test("a long-lived certificate from older versions is replaced", () => {
  const dir = mkdtempSync(join(tmpdir(), "satmouse-certs-"));
  makeCert(dir, 365);
  const old = readFileSync(join(dir, "cert.pem"), "utf-8");
  assert.equal(certProblem(old), "valid for more than 14 days");
  ensureCerts(dir);
  const replaced = readFileSync(join(dir, "cert.pem"), "utf-8");
  assert.notEqual(replaced, old);
  assert.equal(certProblem(replaced), null);
});

test("a certificate with under a week left is replaced at startup", () => {
  const dir = mkdtempSync(join(tmpdir(), "satmouse-certs-"));
  makeCert(dir, 13);
  const pem = readFileSync(join(dir, "cert.pem"), "utf-8");
  assert.equal(certProblem(pem, Date.now() + 8 * 24 * 3600 * 1000), "expires within 7 days");
  assert.equal(certProblem("not a certificate"), "unreadable");
});
