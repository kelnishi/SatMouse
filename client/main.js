import { init, update, reset, setLockPosition, setLockRotation, setLockOrbit, setDominant, setFlip, getFlip, setSensitivity } from "./cube.js";

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

// Control buttons
const btnReset = document.getElementById("btn-reset");
const btnLockPos = document.getElementById("btn-lock-pos");
const btnLockRot = document.getElementById("btn-lock-rot");
const btnLockOrbit = document.getElementById("btn-lock-orbit");
const btnDominant = document.getElementById("btn-dominant");

// Sensitivity sliders — exponential mapping from 0-100 to useful range
const sliderTrans = document.getElementById("slider-trans");
const sliderTransVal = document.getElementById("slider-trans-val");
const sliderRot = document.getElementById("slider-rot");
const sliderRotVal = document.getElementById("slider-rot-val");

function mapSlider(v) {
  // 0 → 0.0001, 50 → 0.005, 100 → 0.05 (exponential)
  return 0.0001 * Math.pow(500, v / 100);
}

sliderTrans.addEventListener("input", () => {
  const v = mapSlider(+sliderTrans.value);
  setSensitivity("t", v);
  sliderTransVal.textContent = v.toFixed(4);
});

sliderRot.addEventListener("input", () => {
  const v = mapSlider(+sliderRot.value);
  setSensitivity("r", v);
  sliderRotVal.textContent = v.toFixed(4);
});

// Set initial display values
sliderTransVal.textContent = mapSlider(+sliderTrans.value).toFixed(4);
sliderRotVal.textContent = mapSlider(+sliderRot.value).toFixed(4);
setSensitivity("t", mapSlider(+sliderTrans.value));
setSensitivity("r", mapSlider(+sliderRot.value));

// Initialize 3D scene
init(canvas);

// Flip checkboxes — sync initial state from cube defaults and wire events
document.querySelectorAll(".flip-cb").forEach(cb => {
  const axis = cb.dataset.axis;
  cb.checked = getFlip(axis);
  cb.addEventListener("change", () => setFlip(axis, cb.checked));
});

// --- Controls ---

btnReset.addEventListener("click", reset);

btnLockPos.addEventListener("click", () => {
  btnLockPos.classList.toggle("active");
  setLockPosition(btnLockPos.classList.contains("active"));
});

btnLockRot.addEventListener("click", () => {
  btnLockRot.classList.toggle("active");
  setLockRotation(btnLockRot.classList.contains("active"));
});

btnLockOrbit.addEventListener("click", () => {
  btnLockOrbit.classList.toggle("active");
  setLockOrbit(btnLockOrbit.classList.contains("active"));
});

btnDominant.addEventListener("click", () => {
  btnDominant.classList.toggle("active");
  setDominant(btnDominant.classList.contains("active"));
});

// --- Connection ---

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

      const newBuf = new Uint8Array(buffer.length + value.length);
      newBuf.set(buffer);
      newBuf.set(value, buffer.length);
      buffer = newBuf;

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
    setTimeout(() => connectWebSocket(url), 2000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// --- Discovery & connection ---

async function discover() {
  const tdUrl = new URL("/td.json", window.location.origin).href;

  try {
    const res = await fetch(tdUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const td = await res.json();

    console.log("Thing Description loaded:", td.title);

    const forms = td.events?.spatialData?.forms ?? [];
    const wtForm = forms.find(f => f.subprotocol === "webtransport");
    const wsForm = forms.find(f => f.subprotocol === "websocket");

    const certHash = td["satmouse:certHash"];
    if (wtForm && typeof WebTransport !== "undefined") {
      const success = await connectWebTransport(wtForm.href, certHash);
      if (success) return;
    }

    if (wsForm) {
      connectWebSocket(wsForm.href);
      return;
    }

    setStatus("", "No endpoints found in TD", "");
  } catch (err) {
    console.warn("Discovery failed, falling back to default WebSocket:", err.message);
    const wsUrl = `ws://${window.location.hostname}:${window.location.port}/spatial`;
    connectWebSocket(wsUrl);
  }
}

discover();
