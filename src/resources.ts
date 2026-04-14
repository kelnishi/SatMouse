import { resolve, dirname, join, normalize } from "node:path";
import { existsSync, realpathSync } from "node:fs";

/**
 * Find the Resources directory in the .app bundle.
 * Works regardless of whether node runs from MacOS/ or Resources/bin/.
 */
function findResourcesDir(): string | null {
  const execDir = dirname(process.execPath);

  // Windows/Linux: resources sit alongside node.exe / node
  if (process.platform !== "darwin") {
    const mainCheck = join(execDir, "main.cjs");
    if (existsSync(mainCheck)) return execDir;
  }

  // MacOS/node → Contents/Resources
  const fromMacOS = resolve(execDir, "..", "Resources");
  if (existsSync(fromMacOS)) return fromMacOS;

  // Resources/bin/node → Contents/Resources (one level up from bin/)
  const fromBin = resolve(execDir, "..");
  const specsCheck = join(fromBin, "main.cjs");
  if (existsSync(specsCheck)) return fromBin;

  return null;
}

const resourcesDir = findResourcesDir();

/**
 * Resolve a resource path safely. Prevents directory traversal.
 * Checks:
 * 1. macOS .app bundle: Contents/Resources/<path>
 * 2. CWD (development mode): ./<path>
 */
export function resolveResource(relativePath: string): string {
  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes("/../")) {
    throw new Error(`Invalid resource path: ${relativePath}`);
  }

  if (resourcesDir) {
    const bundlePath = join(resourcesDir, normalized);
    if (existsSync(bundlePath)) return bundlePath;
  }

  return resolve(normalized);
}

/** Verify a resolved file path is within an allowed directory */
export function isPathWithin(filePath: string, allowedDir: string): boolean {
  try {
    const realFile = realpathSync(filePath);
    const realDir = realpathSync(allowedDir);
    return realFile.startsWith(realDir + "/");
  } catch {
    return false;
  }
}
