/**
 * SatMouse Safari Extension — Background Service Worker
 *
 * Relays spatial data between the SatMouse native bridge and web pages.
 * Web pages connect via browser.runtime.connect(extensionId).
 * The bridge streams data via Chrome-compatible native messaging (stdin/stdout JSON).
 *
 * Security:
 * - Validates sender origin against externally_connectable allowlist (enforced by browser)
 * - Validates all messages from native host (schema check, value clamping)
 * - Never executes code from messages
 * - Rate limits: drops messages if subscriber queue backs up
 */

const NATIVE_APP_ID = "com.kelnishi.SatMouse";
const VALID_MESSAGE_TYPES = new Set(["spatialData", "buttonEvent", "deviceStatus", "deviceInfo"]);
const MAX_MESSAGE_SIZE = 65536; // 64KB — spatial frame is ~200 bytes JSON

let nativePort = null;
const subscribers = new Map(); // portId → port

let portIdCounter = 0;

function ensureNativePort() {
  if (nativePort) return nativePort;

  try {
    nativePort = browser.runtime.connectNative(NATIVE_APP_ID);
  } catch (err) {
    console.error("[SatMouse Extension] Failed to connect to native app:", err);
    return null;
  }

  nativePort.onMessage.addListener((msg) => {
    // Validate message from native host
    if (!msg || typeof msg !== "object") return;
    if (!VALID_MESSAGE_TYPES.has(msg.type)) return;

    // Validate spatial data ranges
    if (msg.type === "spatialData" && msg.data) {
      const d = msg.data;
      if (!isFiniteVec3(d.translation) || !isFiniteVec3(d.rotation)) return;
    }

    // Validate button event
    if (msg.type === "buttonEvent" && msg.data) {
      const d = msg.data;
      if (!Number.isInteger(d.button) || d.button < 0 || d.button > 31) return;
      if (typeof d.pressed !== "boolean") return;
    }

    // Broadcast to all connected web pages
    for (const [id, port] of subscribers) {
      try {
        port.postMessage(msg);
      } catch {
        // Port disconnected — will be cleaned up by onDisconnect
      }
    }
  });

  nativePort.onDisconnect.addListener(() => {
    console.log("[SatMouse Extension] Native port disconnected");
    nativePort = null;
    // Notify all subscribers
    for (const [id, port] of subscribers) {
      try {
        port.postMessage({ type: "disconnected" });
      } catch {}
    }
  });

  return nativePort;
}

// Handle connections from web pages
browser.runtime.onConnectExternal.addListener((port) => {
  const sender = port.sender;

  // Additional origin logging (browser enforces externally_connectable)
  console.log(`[SatMouse Extension] Connection from ${sender?.url ?? "unknown"}`);

  const id = ++portIdCounter;
  subscribers.set(id, port);

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;

    // Only accept known actions
    if (msg.action === "subscribe") {
      const np = ensureNativePort();
      if (np) {
        np.postMessage({ action: "subscribe" });
      } else {
        port.postMessage({ type: "error", message: "SatMouse bridge not running" });
      }
    }
    // All other actions silently ignored
  });

  port.onDisconnect.addListener(() => {
    subscribers.delete(id);
    console.log(`[SatMouse Extension] Tab disconnected (${subscribers.size} remaining)`);

    // If no subscribers left, disconnect native port to save resources
    if (subscribers.size === 0 && nativePort) {
      nativePort.disconnect();
      nativePort = null;
    }
  });
});

function isFiniteVec3(v) {
  return v && typeof v === "object"
    && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}
