// SatMouse Extension — Background
// Connects directly to the bridge via WebSocket (extensions bypass mixed-content)
// and relays spatial data to content scripts via runtime.connect ports.

var api = (typeof browser !== "undefined") ? browser : chrome;
var ws = null;
var subscribers = new Map();
var portId = 0;

function ensureWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  if (ws && ws.readyState === WebSocket.CONNECTING) return;

  try {
    ws = new WebSocket("ws://127.0.0.1:18945/spatial", "satmouse-json");
  } catch (e) {
    console.error("[SatMouse] WebSocket failed:", e);
    return;
  }

  ws.onopen = function() {
    console.log("[SatMouse] Connected to bridge");
    broadcast({ type: "bridgeConnected" });
  };

  ws.onmessage = function(event) {
    try {
      var msg = JSON.parse(event.data);
      broadcast(msg);
    } catch (e) {}
  };

  ws.onclose = function() {
    console.log("[SatMouse] Bridge disconnected");
    ws = null;
    broadcast({ type: "disconnected" });
    // Reconnect after delay
    setTimeout(ensureWebSocket, 2000);
  };

  ws.onerror = function() {
    // onclose will fire next
  };
}

function broadcast(msg) {
  subscribers.forEach(function(port) {
    try { port.postMessage(msg); } catch (e) {}
  });
}

api.runtime.onConnect.addListener(function(port) {
  if (port.name !== "satmouse-page") return;

  var id = ++portId;
  subscribers.set(id, port);
  console.log("[SatMouse] Page connected (" + subscribers.size + " total)");

  // Start WebSocket if not already
  ensureWebSocket();

  // Tell page we're connected if WS is already open
  if (ws && ws.readyState === WebSocket.OPEN) {
    port.postMessage({ type: "connected" });
  }

  port.onMessage.addListener(function(msg) {
    if (!msg) return;
    if (msg.action === "subscribe") {
      ensureWebSocket();
      if (ws && ws.readyState === WebSocket.OPEN) {
        port.postMessage({ type: "connected" });
      }
    }
    if (msg.action === "fetchDevices") {
      fetch("http://127.0.0.1:18945/api/device")
        .then(function(r) { return r.json(); })
        .then(function(data) {
          port.postMessage({ type: "deviceList", data: data.devices || [] });
        })
        .catch(function() {
          port.postMessage({ type: "deviceList", data: [] });
        });
    }
  });

  port.onDisconnect.addListener(function() {
    subscribers.delete(id);
    console.log("[SatMouse] Page disconnected (" + subscribers.size + " remaining)");
    if (subscribers.size === 0 && ws) {
      ws.close();
      ws = null;
    }
  });
});

console.log("[SatMouse] Background loaded");
