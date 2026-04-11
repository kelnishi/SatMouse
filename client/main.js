import { init, update } from "./cube.js";

// DOM elements
const canvas = document.getElementById("canvas");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const protocolLabel = document.getElementById("protocol-label");
const buttonLog = document.getElementById("button-log");

// Spatial readout elements
const valTx = document.getElementById("val-tx");
const valTy = document.getElementById("val-ty");
const valTz = document.getElementById("val-tz");
const valRx = document.getElementById("val-rx");
const valRy = document.getElementById("val-ry");
const valRz = document.getElementById("val-rz");

// Initialize 3D scene
init(canvas);

// Connection state
let connected = false;

function setStatus(state, text, protocol) {
  statusDot.className = state;
  statusText.textContent = text;
  protocolLabel.textContent = protocol || "";
  connected = state === "connected";
}

function handleSpatialData(data) {
  update(data);
  valTx.textContent = Math.round(data.translation.x);
  valTy.textContent = Math.round(data.translation.y);
  valTz.textContent = Math.round(data.translation.z);
  valRx.textContent = Math.round(data.rotation.x);
  valRy.textContent = Math.round(data.rotation.y);
  valRz.textContent = Math.round(data.rotation.z);
}

function handleButtonEvent(data) {
  const entry = document.createElement("div");
  entry.className = `log-entry ${data.pressed ? "pressed" : "released"}`;
  entry.textContent = `btn ${data.button} ${data.pressed ? "pressed" : "released"}`;
  buttonLog.insertBefore(entry, buttonLog.firstChild);

  // Keep log manageable
  while (buttonLog.children.length > 50) {
    buttonLog.removeChild(buttonLog.lastChild);
  }
}

/** Decode 24-byte binary spatial data datagram */
function decodeBinaryFrame(buffer) {
  const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
  return {
    translation: {
      x: view.getInt16(8, true),
      y: view.getInt16(10, true),
      z: view.getInt16(12, true),
    },
    rotation: {
      x: view.getInt16(14, true),
      y: view.getInt16(16, true),
      z: view.getInt16(18, true),
    },
    timestamp: view.getFloat64(0, true),
  };
}

// --- WebTransport connection ---

async function connectWebTransport(url, certHash) {
  setStatus("connecting", "Connecting...", "WebTransport");

  try {
    const options = {};
    if (certHash) {
      options.serverCertificateHashes = [{
        algorithm: "sha-256",
        value: Uint8Array.from(atob(certHash), c => c.charCodeAt(0)),
      }];
    }

    const transport = new WebTransport(url, options);
    await transport.ready;
    setStatus("connected", "Connected", "WebTransport");

    // Read datagrams (spatial data)
    const reader = transport.datagrams.readable.getReader();
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          handleSpatialData(decodeBinaryFrame(value));
        }
      } catch (err) {
        console.warn("Datagram read error:", err);
      }
    })();

    // Read incoming unidirectional streams (button events)
    const streamReader = transport.incomingUnidirectionalStreams.getReader();
    (async () => {
      try {
        while (true) {
          const { value: stream, done } = await streamReader.read();
          if (done) break;
          readButtonStream(stream);
        }
      } catch (err) {
        console.warn("Stream read error:", err);
      }
    })();

    transport.closed.then(() => {
      setStatus("", "Disconnected", "");
    });

    return true;
  } catch (err) {
    console.warn("WebTransport failed:", err.message);
    return false;
  }
}

async function readButtonStream(stream) {
  const reader = stream.getReader();
  let buffer = new Uint8Array(0);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      // Append to buffer
      const newBuf = new Uint8Array(buffer.length + value.length);
      newBuf.set(buffer);
      newBuf.set(value, buffer.length);
      buffer = newBuf;

      // Parse length-prefixed JSON messages
      while (buffer.length >= 4) {
        const len = new DataView(buffer.buffer).getUint32(0, true);
        if (buffer.length < 4 + len) break;
        const json = new TextDecoder().decode(buffer.slice(4, 4 + len));
        handleButtonEvent(JSON.parse(json));
        buffer = buffer.slice(4 + len);
      }
    }
  } catch (err) {
    console.warn("Button stream error:", err);
  }
}

// --- WebSocket connection ---

function connectWebSocket(url) {
  setStatus("connecting", "Connecting...", "WebSocket");

  const ws = new WebSocket(url, "satmouse-json");

  ws.onopen = () => {
    setStatus("connected", "Connected", "WebSocket");
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "spatialData") {
        handleSpatialData(msg.data);
      } else if (msg.type === "buttonEvent") {
        handleButtonEvent(msg.data);
      }
    } catch (err) {
      console.warn("WS parse error:", err);
    }
  };

  ws.onclose = () => {
    setStatus("", "Disconnected", "");
    // Reconnect after delay
    setTimeout(() => connectWebSocket(url), 2000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// --- Discovery & connection ---

async function discover() {
  // Try to fetch td.json from the same host (served by SatMouse)
  const tdUrl = new URL("/td.json", window.location.origin).href;

  try {
    const res = await fetch(tdUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const td = await res.json();

    console.log("Thing Description loaded:", td.title);

    // Find WebTransport and WebSocket endpoints from event forms
    const forms = td.events?.spatialData?.forms ?? [];
    const wtForm = forms.find(f => f.subprotocol === "webtransport");
    const wsForm = forms.find(f => f.subprotocol === "websocket");

    // Try WebTransport first (with cert hash for self-signed certs)
    const certHash = td["satmouse:certHash"];
    if (wtForm && typeof WebTransport !== "undefined") {
      const success = await connectWebTransport(wtForm.href, certHash);
      if (success) return;
    }

    // Fall back to WebSocket
    if (wsForm) {
      connectWebSocket(wsForm.href);
      return;
    }

    setStatus("", "No endpoints found in TD", "");
  } catch (err) {
    console.warn("Discovery failed, falling back to default WebSocket:", err.message);
    // Fall back to default WebSocket endpoint on same host
    const wsUrl = `ws://${window.location.hostname}:${window.location.port}/spatial`;
    connectWebSocket(wsUrl);
  }
}

discover();
