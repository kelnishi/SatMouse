import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";

/**
 * Create a require() function that resolves native addons.
 *
 * In the .app bundle, node can run from two locations:
 *   - Contents/MacOS/node (tray wrapper process)
 *   - Contents/Resources/bin/node (server child process)
 * Both need to find Contents/Resources/node_modules/
 */
function makeNativeRequire(): NodeRequire {
  const execDir = dirname(process.execPath);

  // Check multiple possible locations relative to execPath
  const candidates = [
    join(execDir, "node_modules"),                    // Windows/Linux: node_modules alongside node.exe
    join(execDir, "..", "node_modules"),               // Resources/bin/node → Resources/node_modules
    join(execDir, "..", "Resources", "node_modules"),  // MacOS/node → Resources/node_modules
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return createRequire(join(candidate, "noop.js"));
    }
  }

  // Dev mode — resolve from CWD/node_modules
  return createRequire(join(process.cwd(), "noop.js"));
}

/** Require function for loading native addons (koffi, node-hid, etc.) */
export const nativeRequire = makeNativeRequire();
