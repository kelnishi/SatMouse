import type { Tray, TrayActions } from "./types.js";

export type { Tray, TrayActions };

export async function createTray(): Promise<Tray | null> {
  switch (process.platform) {
    case "darwin": {
      const { MacOSTray } = await import("./macos.js");
      return new MacOSTray();
    }
    case "win32": {
      const { WindowsTray } = await import("./windows.js");
      return new WindowsTray();
    }
    default:
      console.log(`[Tray] Not yet supported on ${process.platform}`);
      return null;
  }
}
