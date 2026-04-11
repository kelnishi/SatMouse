import type { Tray, TrayActions } from "./types.js";

export type { Tray, TrayActions };

export async function createTray(): Promise<Tray | null> {
  switch (process.platform) {
    case "darwin": {
      const { MacOSTray } = await import("./macos.js");
      return new MacOSTray();
    }
    default:
      console.log(`[Tray] Not yet supported on ${process.platform}`);
      return null;
  }
}
