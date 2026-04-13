/**
 * SatMouse Safari Extension — Background Service Worker
 *
 * Relays spatial data between the SatMouse native bridge and web pages.
 * Content scripts connect via browser.runtime.connect().
 * The bridge streams data via Chrome-compatible native messaging (stdin/stdout JSON).
 */

const NATIVE_APP_ID = "com.kelnishi.SatMouse";
const VALID_MESSAGE_TYPES = new Set(["spatialData", "buttonEvent", "deviceStatus", "deviceInfo", "connected", "disconnected"]);

let nativePort = null;
const subscribers = new Map();
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
    if (!msg || typeof msg !== "object") return;
    if (!VALID_MESSAGE_TYPES.has(msg.type)) return;
    for (const [id, port] of subscribers) {
      try { port.postMessage(msg); } catch {}
    }
  });
  nativePort.onDisconnect.addListener(() => {
    nativePort = null;
    for (const [id, port] of subscribers) {
      try { port.postMessage({ type: "disconnected" }); } catch {}
    }
  });
  return nativePort;
}

// Handle connections from content scripts
browser.runtime.onConnect.addListener((port) => {
  if (port.name !== "satmouse-page") return;

  const id = ++portIdCounter;
  subscribers.set(id, port);

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.action === "subscribe") {
      const np = ensureNativePort();
      if (np) {
        np.postMessage({ action: "subscribe" });
      } else {
        port.postMessage({ type: "error", message: "SatMouse bridge not running" });
      }
    }
  });

  port.onDisconnect.addListener(() => {
    subscribers.delete(id);
    if (subscribers.size === 0 && nativePort) {
      nativePort.disconnect();
      nativePort = null;
    }
  });
});
