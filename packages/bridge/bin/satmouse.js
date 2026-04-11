#!/usr/bin/env node

/**
 * npx @kelnishi/satmouse
 *
 * Locates and executes the platform-specific SatMouse binary.
 */

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(__dirname, ".cache");

const binaryName = process.platform === "win32" ? "satmouse.exe" : "satmouse";
const binaryPath = join(cacheDir, binaryName);

if (!existsSync(binaryPath)) {
  console.error("[satmouse] Binary not found. Running install...");
  execFileSync(process.execPath, [join(__dirname, "install.js")], { stdio: "inherit" });

  if (!existsSync(binaryPath)) {
    console.error("[satmouse] Install failed. Download manually from:");
    console.error("  https://github.com/kelnishi/SatMouse/releases/latest");
    process.exit(1);
  }
}

// Forward all args to the native binary
try {
  execFileSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });
} catch (err) {
  process.exit(err.status ?? 1);
}
