import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";

/**
 * Resolve a resource path. Checks:
 * 1. macOS .app bundle: Contents/Resources/<path>
 * 2. CWD (development mode): ./<path>
 */
export function resolveResource(relativePath: string): string {
  // Check if we're inside a .app bundle (executable is at Contents/MacOS/satmouse-bin)
  const execDir = dirname(process.execPath);
  const appResourcesDir = resolve(execDir, "..", "Resources");
  const bundlePath = join(appResourcesDir, relativePath);

  if (existsSync(bundlePath)) {
    return bundlePath;
  }

  // Fall back to CWD (dev mode)
  return resolve(relativePath);
}
