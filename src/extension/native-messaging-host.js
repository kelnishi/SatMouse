#!/usr/bin/env node
// When bundled in .app, launched via: Contents/Resources/bin/node native-messaging-host.js

/**
 * SatMouse Native Messaging Host
 *
 * Bridges the Safari extension to the SatMouse bridge via:
 * - stdin/stdout: Chrome-compatible native messaging protocol (length-prefixed JSON)
 * - WebSocket: connects to the local bridge on ws://127.0.0.1:18945/spatial
 *
 * Security:
 * - Max message size: 64KB (reject larger)
 * - JSON parse in try/catch (never crashes on bad input)
 * - Only known actions accepted
 * - WebSocket connection is localhost-only (127.0.0.1)
 * - No filesystem access, no code execution from messages
 * - Exits cleanly if stdin closes (parent process died)
 */

const WebSocket = require("ws");

const MAX_MESSAGE_SIZE = 65536;
const WS_URL = "ws://127.0.0.1:18945/spatial";
const RECONNECT_DELAY = 2000;

let ws = null;
let reconnectTimer = null;

// --- Native Messaging Protocol (stdin/stdout) ---

/** Read a length-prefixed message from stdin */
function readMessage() {
  const header = Buffer.alloc(4);
  let headerRead = 0;

  process.stdin.on("readable", function onReadable() {
    // Read 4-byte length header
    while (headerRead < 4) {
      const chunk = process.stdin.read(4 - headerRead);
      if (!chunk) return;
      chunk.copy(header, headerRead);
      headerRead += chunk.length;
    }

    const len = header.readUInt32LE(0);

    // Security: reject oversized messages
    if (len > MAX_MESSAGE_SIZE) {
      process.stderr.write(`[NativeHost] Message too large: ${len} bytes\n`);
      headerRead = 0;
      return;
    }

    const body = process.stdin.read(len);
    if (!body) return;

    headerRead = 0;

    try {
      const msg = JSON.parse(body.toString("utf-8"));
      handleMessage(msg);
    } catch {
      process.stderr.write("[NativeHost] Invalid JSON from extension\n");
    }
  });
}

/** Write a length-prefixed JSON message to stdout */
function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, "utf-8");

  if (buf.length > MAX_MESSAGE_SIZE) return; // Drop oversized outgoing messages

  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

/** Handle a message from the extension */
function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return;

  if (msg.action === "subscribe") {
    connectWebSocket();
  }
  // Unknown actions silently ignored
}

// --- WebSocket Connection to Bridge ---

function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(WS_URL, "satmouse-json");
  } catch {
    scheduleReconnect();
    return;
  }

  ws.on("open", () => {
    process.stderr.write("[NativeHost] Connected to bridge\n");
    sendMessage({ type: "connected" });
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      // Validate message type before forwarding
      if (msg.type === "spatialData" || msg.type === "buttonEvent" || msg.type === "deviceStatus") {
        sendMessage(msg);
      }
    } catch {
      // Drop malformed messages from bridge
    }
  });

  ws.on("close", () => {
    ws = null;
    sendMessage({ type: "disconnected" });
    scheduleReconnect();
  });

  ws.on("error", () => {
    // Error handler required to prevent crash — close handler will fire next
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, RECONNECT_DELAY);
}

// --- Lifecycle ---

// Clean exit when stdin closes (extension disconnected or browser quit)
process.stdin.on("end", () => {
  if (ws) ws.close();
  process.exit(0);
});

process.stdin.on("error", () => {
  if (ws) ws.close();
  process.exit(1);
});

// Start reading from extension
readMessage();
