#!/usr/bin/env node

/**
 * postinstall script — downloads the correct SatMouse binary from GitHub Releases.
 *
 * Platform mapping:
 *   darwin-arm64  → SatMouse-macOS-arm64.zip  (extracts .app)
 *   linux-x64     → satmouse-linux-x64.tar.gz
 *   win32-x64     → satmouse-win32-x64.tar.gz
 */

import { existsSync, mkdirSync, createWriteStream, unlinkSync, chmodSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REPO = "kelnishi/SatMouse";
const VERSION = process.env.SATMOUSE_VERSION || "latest";

const PLATFORM_MAP = {
  "darwin-arm64": { asset: "SatMouse-macOS-arm64.zip", binary: "SatMouse.app/Contents/MacOS/satmouse" },
  "linux-x64": { asset: "satmouse-linux-x64.tar.gz", binary: "satmouse" },
  "win32-x64": { asset: "satmouse-win32-x64.tar.gz", binary: "satmouse.exe" },
};

const key = `${process.platform}-${process.arch}`;
const platformInfo = PLATFORM_MAP[key];

if (!platformInfo) {
  console.log(`[satmouse] No prebuilt binary for ${key}. Build from source.`);
  process.exit(0);
}

const binaryDir = join(__dirname, ".cache");
const binaryPath = join(binaryDir, platformInfo.binary.split("/").pop());

if (existsSync(binaryPath)) {
  console.log(`[satmouse] Binary already exists: ${binaryPath}`);
  process.exit(0);
}

async function main() {
  mkdirSync(binaryDir, { recursive: true });

  // Resolve download URL from GitHub Releases API
  const tag = VERSION === "latest" ? "latest" : `tags/${VERSION}`;
  const apiUrl = `https://api.github.com/repos/${REPO}/releases/${tag}`;

  console.log(`[satmouse] Fetching release info...`);
  const release = await fetchJSON(apiUrl);
  const asset = release.assets?.find((a) => a.name === platformInfo.asset);

  if (!asset) {
    console.error(`[satmouse] Asset ${platformInfo.asset} not found in release ${release.tag_name}`);
    console.error(`[satmouse] Download manually from https://github.com/${REPO}/releases`);
    process.exit(1);
  }

  const archivePath = join(binaryDir, asset.name);

  console.log(`[satmouse] Downloading ${asset.name} (${formatBytes(asset.size)})...`);
  await download(asset.browser_download_url, archivePath);

  // Extract
  console.log(`[satmouse] Extracting...`);
  if (asset.name.endsWith(".zip")) {
    execSync(`unzip -o "${archivePath}" -d "${binaryDir}"`, { stdio: "pipe" });
    // For macOS .app bundle, the binary is inside
    const appBinary = join(binaryDir, platformInfo.binary);
    if (existsSync(appBinary) && appBinary !== binaryPath) {
      execSync(`cp "${appBinary}" "${binaryPath}"`, { stdio: "pipe" });
    }
  } else {
    execSync(`tar xzf "${archivePath}" -C "${binaryDir}"`, { stdio: "pipe" });
  }

  // Make executable
  if (process.platform !== "win32") {
    chmodSync(binaryPath, 0o755);
  }

  // Clean up archive
  unlinkSync(archivePath);

  console.log(`[satmouse] Installed to ${binaryPath}`);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { "User-Agent": "satmouse-npm", Accept: "application/json" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve, reject);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON from ${url}`)); }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { "User-Agent": "satmouse-npm" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
      file.on("error", reject);
    }).on("error", reject);
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

main().catch((err) => {
  console.error(`[satmouse] Install failed: ${err.message}`);
  console.error(`[satmouse] Download manually from https://github.com/${REPO}/releases`);
  process.exit(1);
});
