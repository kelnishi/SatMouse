import { resolve, dirname, join, normalize } from "node:path";
import { existsSync, realpathSync } from "node:fs";

/**
 * Resolve a resource path safely. Prevents directory traversal.
 * Checks:
 * 1. macOS .app bundle: Contents/Resources/<path>
 * 2. CWD (development mode): ./<path>
 */
export function resolveResource(relativePath: string): string {
  // Prevent directory traversal
  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes("/../")) {
    throw new Error(`Invalid resource path: ${relativePath}`);
  }

  // Check if we're inside a .app bundle (executable is at Contents/MacOS/satmouse-bin)
  const execDir = dirname(process.execPath);
  const appResourcesDir = resolve(execDir, "..", "Resources");
  const bundlePath = join(appResourcesDir, normalized);

  if (existsSync(bundlePath)) {
    return bundlePath;
  }

  // Fall back to CWD (dev mode)
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
