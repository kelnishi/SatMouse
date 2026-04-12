import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";

/**
 * Create a require() function that resolves native addons.
 *
 * Checks for node_modules in these locations:
 *   - .app bundle: Contents/Resources/node_modules/ (node is at Resources/bin/node)
 *   - Dev mode: ./node_modules/ (CWD)
 */
function makeNativeRequire(): NodeRequire {
  // .app bundle: node lives at Contents/Resources/bin/node
  // node_modules is at Contents/Resources/node_modules/
  const execDir = dirname(process.execPath);
  const bundleModules = join(execDir, "..", "node_modules");

  if (existsSync(bundleModules)) {
    return createRequire(join(bundleModules, "noop.js"));
  }

  // Dev mode — resolve from CWD/node_modules
  return createRequire(join(process.cwd(), "noop.js"));
}

/** Require function for loading native addons (koffi, node-hid, etc.) */
export const nativeRequire = makeNativeRequire();
