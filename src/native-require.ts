import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";

/**
 * Create a require() function that resolves native addons.
 *
 * In the SEA binary, the built-in require() only handles Node.js core modules.
 * We need createRequire() with a path pointing to the actual node_modules:
 *   - .app bundle: Contents/Resources/node_modules/
 *   - Dev mode: ./node_modules/ (CWD)
 */
function makeNativeRequire(): NodeRequire {
  // Check if we're inside a .app bundle
  const execDir = dirname(process.execPath);
  const bundleModules = join(execDir, "..", "Resources", "node_modules");

  if (existsSync(bundleModules)) {
    // .app bundle — resolve from Resources/node_modules
    return createRequire(join(bundleModules, "noop.js"));
  }

  // Dev mode — resolve from CWD/node_modules
  return createRequire(join(process.cwd(), "noop.js"));
}

/** Require function for loading native addons (koffi, node-hid, etc.) */
export const nativeRequire = makeNativeRequire();
