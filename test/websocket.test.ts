import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import { SatMouseWebSocketServer } from "../src/transport/websocket.ts";

const SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

test("the Devices window's EXT badge marks the Safari extension, which now connects with its own origin", async () => {
  const http = createServer();
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const server = new SatMouseWebSocketServer(0);
  server.start(http);
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/spatial`;
  const connect = async (headers: Record<string, string>) => {
    const ws = new WebSocket(url, "satmouse-json", { headers });
    await once(ws, "open");
    return ws;
  };

  const sockets = [
    await connect({ origin: "safari-web-extension://6423d68d-630b-4aa3-8cd8-106a6c37a132", "user-agent": SAFARI_UA }),
    // Earlier Safari sent no origin from the background script
    await connect({ "user-agent": SAFARI_UA }),
    // A page is not the extension, even in Safari
    await connect({ origin: "https://kelnishi.github.io", "user-agent": SAFARI_UA }),
  ];
  try {
    const byOrigin = Object.fromEntries(server.getClientInfo().map((c) => [c.origin, c.extension]));
    assert.deepEqual(byOrigin, {
      "safari-web-extension://6423d68d-630b-4aa3-8cd8-106a6c37a132": true,
      "": true,
      "https://kelnishi.github.io": false,
    });
  } finally {
    for (const ws of sockets) ws.close();
    server.stop();
    http.close();
  }
});
