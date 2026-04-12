// packages/client/src/core/emitter.ts
var TypedEmitter = class {
  listeners = /* @__PURE__ */ new Map();
  on(event, listener) {
    let set = this.listeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }
  off(event, listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
  emit(event, ...args) {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) {
        fn(...args);
      }
    }
  }
  removeAllListeners() {
    this.listeners.clear();
  }
};

// packages/client/src/core/discovery.ts
async function fetchThingDescription(tdUrl) {
  const res = await globalThis.fetch(tdUrl);
  if (!res.ok) throw new Error(`Failed to fetch TD: HTTP ${res.status}`);
  return res.json();
}
function resolveEndpoints(td) {
  const result = {};
  const spatialForms = td.events?.spatialData?.forms ?? [];
  const wtForm = spatialForms.find((f) => f.subprotocol === "webtransport");
  if (wtForm) {
    result.webtransport = {
      url: wtForm.href,
      certHash: td["satmouse:certHash"]
    };
  }
  const wsForm = spatialForms.find((f) => f.subprotocol === "websocket");
  if (wsForm) {
    result.websocket = { url: wsForm.href };
  }
  const deviceForm = td.properties?.deviceInfo?.forms?.[0];
  if (deviceForm) {
    result.deviceInfoUrl = deviceForm.href;
  }
  return result;
}

// packages/client/src/core/decode.ts
function decodeBinaryFrame(buffer) {
  const len = buffer instanceof ArrayBuffer ? buffer.byteLength : buffer.byteLength;
  if (len < 20) {
    throw new RangeError(`Spatial frame too short: expected \u226520 bytes, got ${len}`);
  }
  const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
  const offset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const view = new DataView(ab, offset);
  return {
    translation: {
      x: view.getInt16(8, true),
      y: view.getInt16(10, true),
      z: view.getInt16(12, true)
    },
    rotation: {
      x: view.getInt16(14, true),
      y: view.getInt16(16, true),
      z: view.getInt16(18, true)
    },
    timestamp: view.getFloat64(0, true)
  };
}
function decodeWsBinaryFrame(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 1) return null;
  const typePrefix = bytes[0];
  if (typePrefix === 1 && bytes.length >= 25) {
    return { type: "spatialData", data: decodeBinaryFrame(bytes.subarray(1, 25)) };
  }
  if (typePrefix === 2) {
    const json = new TextDecoder().decode(bytes.subarray(1));
    return { type: "buttonEvent", data: JSON.parse(json) };
  }
  return null;
}
function decodeButtonStream(buffer) {
  const events = [];
  let pos = 0;
  while (pos + 4 <= buffer.length) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + pos);
    const len = view.getUint32(0, true);
    if (len > 65536 || pos + 4 + len > buffer.length) break;
    const json = new TextDecoder().decode(buffer.subarray(pos + 4, pos + 4 + len));
    try {
      const event = JSON.parse(json);
      if (typeof event.button === "number" && typeof event.pressed === "boolean") {
        events.push(event);
      }
    } catch {
    }
    pos += 4 + len;
  }
  return { events, remainder: buffer.subarray(pos) };
}

// packages/client/src/core/transports/webtransport.ts
var WebTransportAdapter = class {
  protocol = "webtransport";
  onSpatialData = null;
  onButtonEvent = null;
  onClose = null;
  onError = null;
  transport = null;
  url;
  certHash;
  constructor(url, certHash) {
    this.url = url;
    this.certHash = certHash;
  }
  async connect() {
    if (typeof globalThis.WebTransport === "undefined") {
      throw new Error("WebTransport is not available in this environment");
    }
    const options = {};
    if (this.certHash) {
      options.serverCertificateHashes = [
        {
          algorithm: "sha-256",
          value: Uint8Array.from(atob(this.certHash), (c) => c.charCodeAt(0))
        }
      ];
    }
    this.transport = new globalThis.WebTransport(this.url, options);
    await this.transport.ready;
    this.readDatagrams();
    this.readStreams();
    this.transport.closed.then(() => this.onClose?.()).catch(() => this.onClose?.());
  }
  close() {
    try {
      this.transport?.close();
    } catch {
    }
    this.transport = null;
  }
  async readDatagrams() {
    const reader = this.transport.datagrams.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        this.onSpatialData?.(decodeBinaryFrame(value));
      }
    } catch {
    }
  }
  async readStreams() {
    const reader = this.transport.incomingUnidirectionalStreams.getReader();
    try {
      while (true) {
        const { value: stream, done } = await reader.read();
        if (done) break;
        this.readButtonStream(stream);
      }
    } catch {
    }
  }
  async readButtonStream(stream) {
    const reader = stream.getReader();
    let buffer = new Uint8Array(0);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const newBuf = new Uint8Array(buffer.length + value.length);
        newBuf.set(buffer);
        newBuf.set(value, buffer.length);
        const { events, remainder } = decodeButtonStream(newBuf);
        for (const event of events) {
          this.onButtonEvent?.(event);
        }
        buffer = remainder;
      }
    } catch {
    }
  }
};

// packages/client/src/core/transports/websocket.ts
var WebSocketAdapter = class {
  protocol = "websocket";
  onSpatialData = null;
  onButtonEvent = null;
  onDeviceStatus = null;
  onClose = null;
  onError = null;
  ws = null;
  url;
  subprotocol;
  constructor(url, subprotocol = "satmouse-json") {
    this.url = url;
    this.subprotocol = subprotocol;
  }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new globalThis.WebSocket(this.url, this.subprotocol);
      if (this.subprotocol === "satmouse-binary") {
        this.ws.binaryType = "arraybuffer";
      }
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => {
        reject(new Error(`WebSocket connection failed: ${this.url}`));
      };
      this.ws.onmessage = (event) => {
        if (this.subprotocol === "satmouse-binary" && event.data instanceof ArrayBuffer) {
          const decoded = decodeWsBinaryFrame(event.data);
          if (decoded?.type === "spatialData") this.onSpatialData?.(decoded.data);
          else if (decoded?.type === "buttonEvent") this.onButtonEvent?.(decoded.data);
        } else if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "spatialData") this.onSpatialData?.(msg.data);
            else if (msg.type === "buttonEvent") this.onButtonEvent?.(msg.data);
            else if (msg.type === "deviceStatus") {
              this.onDeviceStatus?.(msg.data.event, msg.data.device);
            }
          } catch {
          }
        }
      };
      this.ws.onclose = () => this.onClose?.();
    });
  }
  close() {
    try {
      this.ws?.close();
    } catch {
    }
    this.ws = null;
  }
};

// packages/client/src/core/connection.ts
function parseSatMouseUri(uri) {
  const url = new URL(uri);
  const host = url.searchParams.get("host") ?? "localhost";
  const wsPort = url.searchParams.get("wsPort") ?? "18944";
  const wtPort = url.searchParams.get("wtPort") ?? "18943";
  return {
    tdUrl: `http://${host}:${wsPort}/td.json`,
    wsUrl: `ws://${host}:${wsPort}/spatial`,
    wtUrl: `https://${host}:${wtPort}`
  };
}
var DEFAULT_OPTIONS = {
  transports: ["webtransport", "websocket"],
  reconnectDelay: 2e3,
  wsSubprotocol: "satmouse-json"
};
var SatMouseConnection = class extends TypedEmitter {
  options;
  transport = null;
  reconnectTimer = null;
  intentionalClose = false;
  deviceInfoUrl = null;
  _state = "disconnected";
  _protocol = "none";
  get state() {
    return this._state;
  }
  get protocol() {
    return this._protocol;
  }
  constructor(options) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }
  async connect() {
    this.intentionalClose = false;
    this.setState("connecting", "none");
    let wtUrl = this.options.wtUrl;
    let wsUrl = this.options.wsUrl;
    let certHash = this.options.certHash;
    if (this.options.uri) {
      const parsed = parseSatMouseUri(this.options.uri);
      wtUrl = wtUrl ?? parsed.wtUrl;
      wsUrl = wsUrl ?? parsed.wsUrl;
      this.options.tdUrl = this.options.tdUrl ?? parsed.tdUrl;
    }
    if (!wtUrl && !wsUrl) {
      const tdUrl = this.options.tdUrl ?? new URL("/td.json", globalThis.location?.origin ?? "http://localhost:18944").href;
      try {
        const td = await fetchThingDescription(tdUrl);
        const endpoints = resolveEndpoints(td);
        wtUrl = endpoints.webtransport?.url;
        wsUrl = endpoints.websocket?.url;
        certHash = certHash ?? endpoints.webtransport?.certHash;
        this.deviceInfoUrl = endpoints.deviceInfoUrl ?? null;
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
        wsUrl = `ws://${globalThis.location?.hostname ?? "localhost"}:${globalThis.location?.port ?? "18944"}/spatial`;
      }
    }
    for (const proto of this.options.transports) {
      if (proto === "webtransport" && wtUrl) {
        try {
          if (typeof globalThis.WebTransport === "undefined") continue;
          const adapter = new WebTransportAdapter(wtUrl, certHash);
          if (await this.tryTransport(adapter)) return;
        } catch {
          continue;
        }
      }
      if (proto === "websocket" && wsUrl) {
        try {
          const adapter = new WebSocketAdapter(wsUrl, this.options.wsSubprotocol);
          if (await this.tryTransport(adapter)) return;
        } catch {
          continue;
        }
      }
    }
    this.setState("disconnected", "none");
    this.scheduleReconnect();
  }
  disconnect() {
    this.intentionalClose = true;
    this.clearReconnect();
    this.transport?.close();
    this.transport = null;
    this.setState("disconnected", "none");
  }
  async fetchDeviceInfo() {
    if (!this.deviceInfoUrl) return [];
    const res = await globalThis.fetch(this.deviceInfoUrl);
    if (!res.ok) return [];
    const data = await res.json();
    return data.devices ?? [];
  }
  async tryTransport(adapter) {
    adapter.onSpatialData = (data) => this.emit("spatialData", data);
    adapter.onButtonEvent = (data) => this.emit("buttonEvent", data);
    adapter.onError = (err) => this.emit("error", err);
    if ("onDeviceStatus" in adapter) {
      adapter.onDeviceStatus = (event, device) => {
        this.emit("deviceStatus", event, device);
      };
    }
    adapter.onClose = () => {
      this.transport = null;
      this.setState("disconnected", "none");
      if (!this.intentionalClose) this.scheduleReconnect();
    };
    try {
      await adapter.connect();
      this.transport = adapter;
      this.setState("connected", adapter.protocol);
      return true;
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }
  setState(state, protocol) {
    if (this._state === state && this._protocol === protocol) return;
    this._state = state;
    this._protocol = protocol;
    this.emit("stateChange", state, protocol);
  }
  scheduleReconnect() {
    if (this.options.reconnectDelay <= 0 || this.intentionalClose) return;
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.options.reconnectDelay);
  }
  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
};

// packages/client/src/utils/config.ts
var DEFAULT_CONFIG = {
  sensitivity: { translation: 1e-3, rotation: 1e-3 },
  flip: { tx: false, ty: true, tz: true, rx: false, ry: true, rz: true },
  deadZone: 0,
  dominant: false,
  axisRemap: { tx: "x", ty: "y", tz: "z", rx: "x", ry: "y", rz: "z" },
  lockPosition: false,
  lockRotation: false
};
function mergeConfig(base, partial) {
  return {
    ...base,
    ...partial,
    sensitivity: { ...base.sensitivity, ...partial.sensitivity },
    flip: { ...base.flip, ...partial.flip },
    axisRemap: { ...base.axisRemap, ...partial.axisRemap }
  };
}

// packages/client/src/utils/persistence.ts
var STORAGE_KEY = "satmouse:settings";
function getStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
function saveSettings(config, storage) {
  const s = getStorage(storage);
  if (!s) return;
  s.setItem(STORAGE_KEY, JSON.stringify(config));
}
function loadSettings(storage) {
  const s = getStorage(storage);
  if (!s) return null;
  const raw = s.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// packages/client/src/utils/transforms.ts
function applyFlip(data, flip) {
  return {
    ...data,
    translation: {
      x: flip.tx ? -data.translation.x : data.translation.x,
      y: flip.ty ? -data.translation.y : data.translation.y,
      z: flip.tz ? -data.translation.z : data.translation.z
    },
    rotation: {
      x: flip.rx ? -data.rotation.x : data.rotation.x,
      y: flip.ry ? -data.rotation.y : data.rotation.y,
      z: flip.rz ? -data.rotation.z : data.rotation.z
    }
  };
}
function applySensitivity(data, sens) {
  return {
    ...data,
    translation: {
      x: data.translation.x * sens.translation,
      y: data.translation.y * sens.translation,
      z: data.translation.z * sens.translation
    },
    rotation: {
      x: data.rotation.x * sens.rotation,
      y: data.rotation.y * sens.rotation,
      z: data.rotation.z * sens.rotation
    }
  };
}
function applyDominant(data) {
  const axes = [
    { group: "t", key: "x", v: Math.abs(data.translation.x) },
    { group: "t", key: "y", v: Math.abs(data.translation.y) },
    { group: "t", key: "z", v: Math.abs(data.translation.z) },
    { group: "r", key: "x", v: Math.abs(data.rotation.x) },
    { group: "r", key: "y", v: Math.abs(data.rotation.y) },
    { group: "r", key: "z", v: Math.abs(data.rotation.z) }
  ];
  const max = axes.reduce((a, b) => b.v > a.v ? b : a);
  const t = { x: 0, y: 0, z: 0 };
  const r = { x: 0, y: 0, z: 0 };
  if (max.group === "t") t[max.key] = data.translation[max.key];
  else r[max.key] = data.rotation[max.key];
  return { ...data, translation: t, rotation: r };
}
function applyDeadZone(data, threshold) {
  const dz = (v) => Math.abs(v) < threshold ? 0 : v;
  return {
    ...data,
    translation: { x: dz(data.translation.x), y: dz(data.translation.y), z: dz(data.translation.z) },
    rotation: { x: dz(data.rotation.x), y: dz(data.rotation.y), z: dz(data.rotation.z) }
  };
}
function applyAxisRemap(data, map) {
  return {
    ...data,
    translation: {
      x: 0,
      y: 0,
      z: 0,
      [map.tx]: data.translation.x,
      [map.ty]: data.translation.y,
      [map.tz]: data.translation.z
    },
    rotation: {
      x: 0,
      y: 0,
      z: 0,
      [map.rx]: data.rotation.x,
      [map.ry]: data.rotation.y,
      [map.rz]: data.rotation.z
    }
  };
}

// packages/client/src/utils/input-manager.ts
var InputManager = class extends TypedEmitter {
  connections = [];
  storage;
  _config;
  get config() {
    return this._config;
  }
  constructor(config, storage) {
    super();
    this.storage = storage;
    const persisted = loadSettings(storage);
    this._config = mergeConfig(DEFAULT_CONFIG, { ...config, ...persisted });
  }
  /** Add a connection to the managed set */
  addConnection(connection2) {
    this.connections.push(connection2);
    this.wireConnection(connection2);
  }
  /** Remove a connection */
  removeConnection(connection2) {
    const idx = this.connections.indexOf(connection2);
    if (idx !== -1) this.connections.splice(idx, 1);
    connection2.removeAllListeners();
  }
  /** Connect all managed connections */
  async connect() {
    await Promise.all(this.connections.map((c) => c.connect()));
  }
  /** Disconnect all managed connections */
  disconnect() {
    for (const c of this.connections) c.disconnect();
  }
  /** Fetch device info from all connections */
  async fetchDeviceInfo() {
    const results = await Promise.all(this.connections.map((c) => c.fetchDeviceInfo()));
    return results.flat();
  }
  /** Update configuration. Persists by default. */
  updateConfig(partial, persist = true) {
    this._config = mergeConfig(this._config, partial);
    if (persist) saveSettings(this._config, this.storage);
    this.emit("configChange", this._config);
  }
  /** Register a callback for processed spatial data. Returns unsubscribe function. */
  onSpatialData(callback) {
    this.on("spatialData", callback);
    return () => this.off("spatialData", callback);
  }
  /** Register a callback for button events. Returns unsubscribe function. */
  onButtonEvent(callback) {
    this.on("buttonEvent", callback);
    return () => this.off("buttonEvent", callback);
  }
  wireConnection(connection2) {
    connection2.on("spatialData", (raw) => {
      this.emit("rawSpatialData", raw);
      const processed = this.processSpatialData(raw);
      if (processed) this.emit("spatialData", processed);
    });
    connection2.on("buttonEvent", (event) => this.emit("buttonEvent", event));
    connection2.on("stateChange", (state, proto) => this.emit("stateChange", state, proto));
    connection2.on("deviceStatus", (event, device) => this.emit("deviceStatus", event, device));
  }
  processSpatialData(raw) {
    const cfg = this._config;
    let data = raw;
    if (cfg.deadZone > 0) data = applyDeadZone(data, cfg.deadZone);
    if (cfg.dominant) data = applyDominant(data);
    data = applyFlip(data, cfg.flip);
    data = applyAxisRemap(data, cfg.axisRemap);
    data = applySensitivity(data, cfg.sensitivity);
    if (cfg.lockPosition) {
      data = { ...data, translation: { x: 0, y: 0, z: 0 } };
    }
    if (cfg.lockRotation) {
      data = { ...data, rotation: { x: 0, y: 0, z: 0 } };
    }
    return data;
  }
};

// client/src/cube.ts
import * as THREE from "three";
var scene;
var camera;
var renderer;
var cube;
var _quat = new THREE.Quaternion();
var _euler = new THREE.Euler();
function init(canvas2) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(1710638);
  camera = new THREE.PerspectiveCamera(50, canvas2.clientWidth / canvas2.clientHeight, 0.1, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(0, -5, 0);
  camera.lookAt(0, 0, 0);
  renderer = new THREE.WebGLRenderer({ canvas: canvas2, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas2.clientWidth, canvas2.clientHeight);
  scene.add(new THREE.AmbientLight(4210752, 2));
  const dirLight = new THREE.DirectionalLight(16777215, 1.5);
  dirLight.position.set(3, 4, 5);
  scene.add(dirLight);
  const geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
  const material = new THREE.MeshStandardMaterial({
    color: 3447003,
    metalness: 0.3,
    roughness: 0.4
  });
  cube = new THREE.Mesh(geometry, material);
  scene.add(cube);
  cube.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 6139362, linewidth: 1 })
    )
  );
  const grid = new THREE.GridHelper(10, 20, 996448, 996448);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -2;
  scene.add(grid);
  const observer = new ResizeObserver(() => {
    const w = canvas2.clientWidth;
    const h = canvas2.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  observer.observe(canvas2);
  (function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  })();
}
function applyFrame(data, lockOrbit2) {
  if (!cube) return;
  cube.position.x += data.translation.x;
  cube.position.y += data.translation.y;
  cube.position.z += data.translation.z;
  _euler.set(data.rotation.x, data.rotation.y, data.rotation.z, "XYZ");
  _quat.setFromEuler(_euler);
  if (lockOrbit2) {
    const offset = camera.position.clone().sub(cube.position);
    offset.applyQuaternion(_quat.invert());
    camera.position.copy(cube.position).add(offset);
    camera.lookAt(cube.position);
  } else {
    cube.quaternion.premultiply(_quat);
  }
}
function reset() {
  if (!cube) return;
  cube.position.set(0, 0, 0);
  cube.quaternion.identity();
  camera.position.set(0, -5, 0);
  camera.lookAt(0, 0, 0);
}

// client/src/main.ts
var canvas = document.getElementById("canvas");
var statusDot = document.getElementById("status-dot");
var statusText = document.getElementById("status-text");
var protocolLabel = document.getElementById("protocol-label");
var buttonLog = document.getElementById("button-log");
var valTx = document.getElementById("val-tx");
var valTy = document.getElementById("val-ty");
var valTz = document.getElementById("val-tz");
var valRx = document.getElementById("val-rx");
var valRy = document.getElementById("val-ry");
var valRz = document.getElementById("val-rz");
var btnReset = document.getElementById("btn-reset");
var btnLockPos = document.getElementById("btn-lock-pos");
var btnLockRot = document.getElementById("btn-lock-rot");
var btnLockOrbit = document.getElementById("btn-lock-orbit");
var btnDominant = document.getElementById("btn-dominant");
var sliderTrans = document.getElementById("slider-trans");
var sliderTransVal = document.getElementById("slider-trans-val");
var sliderRot = document.getElementById("slider-rot");
var sliderRotVal = document.getElementById("slider-rot-val");
var connection = new SatMouseConnection();
var manager = new InputManager();
manager.addConnection(connection);
var lockOrbit = false;
init(canvas);
manager.onSpatialData((data) => {
  applyFrame(data, lockOrbit);
});
manager.on("rawSpatialData", (data) => {
  valTx.textContent = String(Math.round(data.translation.x));
  valTy.textContent = String(Math.round(data.translation.y));
  valTz.textContent = String(Math.round(data.translation.z));
  valRx.textContent = String(Math.round(data.rotation.x));
  valRy.textContent = String(Math.round(data.rotation.y));
  valRz.textContent = String(Math.round(data.rotation.z));
});
manager.onButtonEvent((data) => {
  const entry = document.createElement("div");
  entry.className = `log-entry ${data.pressed ? "pressed" : "released"}`;
  entry.textContent = `btn ${data.button} ${data.pressed ? "pressed" : "released"}`;
  buttonLog.insertBefore(entry, buttonLog.firstChild);
  while (buttonLog.children.length > 50) {
    buttonLog.removeChild(buttonLog.lastChild);
  }
});
manager.on("stateChange", (state, protocol) => {
  statusDot.className = state;
  statusText.textContent = state === "connected" ? "Connected" : state === "connecting" ? "Connecting..." : "Disconnected";
  protocolLabel.textContent = protocol !== "none" ? protocol : "";
});
btnReset.addEventListener("click", reset);
function toggleButton(btn, key) {
  btn.addEventListener("click", () => {
    btn.classList.toggle("active");
    manager.updateConfig({ [key]: btn.classList.contains("active") });
  });
}
toggleButton(btnLockPos, "lockPosition");
toggleButton(btnLockRot, "lockRotation");
toggleButton(btnDominant, "dominant");
btnLockOrbit.addEventListener("click", () => {
  btnLockOrbit.classList.toggle("active");
  lockOrbit = btnLockOrbit.classList.contains("active");
});
document.querySelectorAll(".flip-cb").forEach((cb) => {
  const axis = cb.dataset.axis;
  cb.checked = manager.config.flip[axis];
  cb.addEventListener("change", () => {
    manager.updateConfig({ flip: { ...manager.config.flip, [axis]: cb.checked } });
  });
});
function mapSlider(v) {
  return 1e-4 * Math.pow(500, v / 100);
}
function unmapSlider(v) {
  return 100 * Math.log(v / 1e-4) / Math.log(500);
}
sliderTrans.value = String(Math.round(unmapSlider(manager.config.sensitivity.translation)));
sliderTransVal.textContent = manager.config.sensitivity.translation.toFixed(4);
sliderRot.value = String(Math.round(unmapSlider(manager.config.sensitivity.rotation)));
sliderRotVal.textContent = manager.config.sensitivity.rotation.toFixed(4);
sliderTrans.addEventListener("input", () => {
  const v = mapSlider(+sliderTrans.value);
  manager.updateConfig({ sensitivity: { ...manager.config.sensitivity, translation: v } });
  sliderTransVal.textContent = v.toFixed(4);
});
sliderRot.addEventListener("input", () => {
  const v = mapSlider(+sliderRot.value);
  manager.updateConfig({ sensitivity: { ...manager.config.sensitivity, rotation: v } });
  sliderRotVal.textContent = v.toFixed(4);
});
connection.connect();
