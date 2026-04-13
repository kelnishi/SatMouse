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
  const wsPort = url.searchParams.get("wsPort") ?? "18945";
  const wtPort = url.searchParams.get("wtPort") ?? "18946";
  return {
    tdUrl: `http://${host}:${wsPort}/td.json`,
    wsUrl: `ws://${host}:${wsPort}/spatial`,
    wtUrl: `https://${host}:${wtPort}`
  };
}
var DEFAULT_OPTIONS = {
  transports: ["webtransport", "websocket"],
  reconnectDelay: 2e3,
  maxRetries: 3,
  wsSubprotocol: "satmouse-json"
};
var SatMouseConnection = class extends TypedEmitter {
  options;
  transport = null;
  reconnectTimer = null;
  intentionalClose = false;
  deviceInfoUrl = null;
  retryCount = 0;
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
      const tdUrl = this.options.tdUrl ?? "http://localhost:18945/td.json";
      try {
        const td = await fetchThingDescription(tdUrl);
        const endpoints = resolveEndpoints(td);
        wtUrl = endpoints.webtransport?.url;
        wsUrl = endpoints.websocket?.url;
        certHash = certHash ?? endpoints.webtransport?.certHash;
        this.deviceInfoUrl = endpoints.deviceInfoUrl ?? null;
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
        wsUrl = "ws://localhost:18945/spatial";
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
  /** Reset retry count and reconnect. Use after "failed" state. */
  retry() {
    this.retryCount = 0;
    this.intentionalClose = false;
    this.connect();
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
      this.retryCount = 0;
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
    this.retryCount++;
    console.log(`[SatMouse] Reconnect attempt ${this.retryCount}/${this.options.maxRetries}`);
    if (this.retryCount > this.options.maxRetries) {
      console.log("[SatMouse] Max retries exceeded, giving up");
      this.setState("failed", "none");
      return;
    }
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

// packages/client/src/utils/action-map.ts
var FULL_AXES = ["tx", "ty", "tz", "rx", "ry", "rz"];
var DEFAULT_ROUTES = [
  { source: "tx", target: "tx" },
  { source: "ty", target: "ty" },
  { source: "tz", target: "tz" },
  { source: "rx", target: "rx" },
  { source: "ry", target: "ry" },
  { source: "rz", target: "rz" }
];
function buildRoutes(axes) {
  return axes.map((axis) => {
    const base = axis.replace(/[+-]$/, "");
    const flip = axis.endsWith("-");
    return { source: axis, target: base, ...flip && { flip: true } };
  });
}
function readAxis(data, axis) {
  const base = axis.replace(/[+-]$/, "");
  switch (base) {
    case "tx":
      return data.translation.x;
    case "ty":
      return data.translation.y;
    case "tz":
      return data.translation.z;
    case "rx":
      return data.rotation.x;
    case "ry":
      return data.rotation.y;
    case "rz":
      return data.rotation.z;
    default:
      return 0;
  }
}
function writeAxis(t, r, axis, value) {
  const isNeg = axis.endsWith("-");
  const base = axis.replace(/[+-]$/, "");
  const sign = isNeg ? -1 : 1;
  const group = base[0];
  const key = base[1];
  if (group === "t") t[key] += value * sign;
  else r[key] += value * sign;
}
function applyRoutes(data, routes, scale = 1) {
  const t = { x: 0, y: 0, z: 0 };
  const r = { x: 0, y: 0, z: 0 };
  for (const route of routes) {
    let value = readAxis(data, route.source);
    if (route.flip) value = -value;
    value *= scale;
    writeAxis(t, r, route.target, value);
  }
  return { translation: t, rotation: r, timestamp: data.timestamp, deviceId: data.deviceId };
}

// packages/client/src/utils/config.ts
var DEFAULT_CONFIG = {
  routes: DEFAULT_ROUTES,
  buttonRoutes: [],
  scale: 1e-3,
  deadZone: 0,
  dominant: false,
  lockPosition: false,
  lockRotation: false,
  devices: {
    "cnx-*": {
      routes: [
        { source: "tx", target: "tx" },
        { source: "ty", target: "ty", flip: true },
        { source: "tz", target: "tz", flip: true },
        { source: "rx", target: "rx" },
        { source: "ry", target: "ry", flip: true },
        { source: "rz", target: "rz", flip: true }
      ]
    },
    // PlayStation: L2 (ty) → TY, R2 (ry) → TY flipped (push-pull)
    "hid-54c-*": {
      routes: [
        { source: "tx", target: "tx" },
        { source: "tz", target: "tz" },
        { source: "rz", target: "rz" },
        { source: "rx", target: "rx" },
        { source: "ty", target: "ty" },
        { source: "ry", target: "ty", flip: true }
      ]
    }
  }
};
function mergeConfig(base, partial) {
  const merged = {
    ...base,
    ...partial,
    routes: partial.routes ?? [...base.routes],
    buttonRoutes: partial.buttonRoutes ?? [...base.buttonRoutes],
    devices: { ...base.devices }
  };
  if (partial.devices) {
    for (const [key, devCfg] of Object.entries(partial.devices)) {
      merged.devices[key] = { ...merged.devices[key], ...devCfg };
    }
  }
  return merged;
}
function resolveDeviceConfig(config, deviceId) {
  let deviceOverride;
  if (config.devices[deviceId]) {
    deviceOverride = config.devices[deviceId];
  } else {
    for (const [pattern, cfg] of Object.entries(config.devices)) {
      if (pattern.endsWith("*") && deviceId.startsWith(pattern.slice(0, -1))) {
        deviceOverride = cfg;
        break;
      }
    }
  }
  if (!deviceOverride) return config;
  return {
    ...config,
    routes: deviceOverride.routes ?? config.routes,
    buttonRoutes: deviceOverride.buttonRoutes ?? config.buttonRoutes,
    scale: deviceOverride.scale ?? config.scale,
    deadZone: deviceOverride.deadZone ?? config.deadZone,
    dominant: deviceOverride.dominant ?? config.dominant
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
function clearSettings(storage) {
  const s = getStorage(storage);
  if (!s) return;
  s.setItem(STORAGE_KEY, "{}");
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

// packages/client/src/utils/input-manager.ts
var InputManager = class extends TypedEmitter {
  connections = [];
  storage;
  knownDevices = /* @__PURE__ */ new Map();
  deviceAccumulators = /* @__PURE__ */ new Map();
  accDirty = false;
  flushTimer = null;
  _config;
  _state = "disconnected";
  _protocol = "none";
  get config() {
    return this._config;
  }
  get state() {
    return this._state;
  }
  get protocol() {
    return this._protocol;
  }
  constructor(config, storage) {
    super();
    this.storage = storage;
    const persisted = loadSettings(storage);
    this._config = mergeConfig(DEFAULT_CONFIG, { ...config, ...persisted });
    this.flushTimer = setInterval(() => this.flushAccumulator(), 16);
  }
  addConnection(connection2) {
    this.connections.push(connection2);
    this.wireConnection(connection2);
  }
  /** Reset retry count and reconnect all failed connections. */
  retry() {
    for (const c of this.connections) c.retry();
  }
  removeConnection(connection2) {
    const idx = this.connections.indexOf(connection2);
    if (idx !== -1) this.connections.splice(idx, 1);
    connection2.removeAllListeners();
  }
  async connect() {
    await Promise.all(this.connections.map((c) => c.connect()));
  }
  disconnect() {
    for (const c of this.connections) c.disconnect();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
  async fetchDeviceInfo() {
    const results = await Promise.all(this.connections.map((c) => c.fetchDeviceInfo()));
    const devices = results.flat();
    for (const d of devices) this.knownDevices.set(d.id, d);
    return devices;
  }
  getDevicesWithConfig() {
    return Array.from(this.knownDevices.values()).map((device) => ({
      device,
      config: this.getDeviceConfig(device.id)
    }));
  }
  getDeviceConfig(deviceId) {
    const resolved = resolveDeviceConfig(this._config, deviceId);
    return {
      routes: resolved.routes,
      scale: resolved.scale,
      deadZone: resolved.deadZone,
      dominant: resolved.dominant
    };
  }
  updateConfig(partial, persist = true) {
    this._config = mergeConfig(this._config, partial);
    if (persist) saveSettings(this._config, this.storage);
    this.emit("configChange", this._config);
  }
  updateDeviceConfig(deviceId, partial, persist = true) {
    const existing = this._config.devices[deviceId] ?? {};
    this._config = mergeConfig(this._config, {
      devices: { [deviceId]: { ...existing, ...partial } }
    });
    if (persist) saveSettings(this._config, this.storage);
    this.emit("configChange", this._config);
  }
  resetDeviceConfig(deviceId, persist = true) {
    const { [deviceId]: _, ...rest } = this._config.devices;
    this._config = { ...this._config, devices: rest };
    if (persist) saveSettings(this._config, this.storage);
    this.emit("configChange", this._config);
  }
  resetAllConfig() {
    clearSettings(this.storage);
    this._config = { ...DEFAULT_CONFIG };
    this.emit("configChange", this._config);
  }
  onSpatialData(callback) {
    this.on("spatialData", callback);
    return () => this.off("spatialData", callback);
  }
  onButtonEvent(callback) {
    this.on("buttonEvent", callback);
    return () => this.off("buttonEvent", callback);
  }
  wireConnection(connection2) {
    connection2.on("spatialData", (raw) => {
      this.emit("rawSpatialData", raw);
      const id = raw.deviceId ?? "_default";
      const processed = this.processPerDevice(raw, id);
      this.deviceAccumulators.set(id, {
        tx: processed.translation.x,
        ty: processed.translation.y,
        tz: processed.translation.z,
        rx: processed.rotation.x,
        ry: processed.rotation.y,
        rz: processed.rotation.z
      });
      this.accDirty = true;
    });
    connection2.on("buttonEvent", (event) => {
      this.dispatchButtonKeys(event);
      this.emit("buttonEvent", event);
    });
    connection2.on("stateChange", (state, proto) => {
      this._state = state;
      this._protocol = proto;
      this.emit("stateChange", state, proto);
    });
    connection2.on("deviceStatus", (event, device) => {
      if (event === "connected") this.knownDevices.set(device.id, device);
      else this.knownDevices.delete(device.id);
      this.emit("deviceStatus", event, device);
    });
  }
  flushAccumulator() {
    if (!this.accDirty) return;
    const merged = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
    for (const acc of this.deviceAccumulators.values()) {
      merged.tx += acc.tx;
      merged.ty += acc.ty;
      merged.tz += acc.tz;
      merged.rx += acc.rx;
      merged.ry += acc.ry;
      merged.rz += acc.rz;
    }
    this.deviceAccumulators.clear();
    this.accDirty = false;
    let data = {
      translation: { x: merged.tx, y: merged.ty, z: merged.tz },
      rotation: { x: merged.rx, y: merged.ry, z: merged.rz },
      timestamp: performance.now() * 1e3
    };
    if (this._config.lockPosition) {
      data = { ...data, translation: { x: 0, y: 0, z: 0 } };
    }
    if (this._config.lockRotation) {
      data = { ...data, rotation: { x: 0, y: 0, z: 0 } };
    }
    this.emit("spatialData", data);
  }
  /** Per-device: deadZone → dominant → routes (flip + scale + remap in one pass) */
  processPerDevice(raw, deviceId) {
    const cfg = resolveDeviceConfig(this._config, deviceId);
    let data = raw;
    if (cfg.deadZone > 0) {
      const dz = (v) => Math.abs(v) < cfg.deadZone ? 0 : v;
      data = {
        ...data,
        translation: { x: dz(data.translation.x), y: dz(data.translation.y), z: dz(data.translation.z) },
        rotation: { x: dz(data.rotation.x), y: dz(data.rotation.y), z: dz(data.rotation.z) }
      };
    }
    if (cfg.dominant) {
      const axes = [
        { g: "t", k: "x", v: Math.abs(data.translation.x) },
        { g: "t", k: "y", v: Math.abs(data.translation.y) },
        { g: "t", k: "z", v: Math.abs(data.translation.z) },
        { g: "r", k: "x", v: Math.abs(data.rotation.x) },
        { g: "r", k: "y", v: Math.abs(data.rotation.y) },
        { g: "r", k: "z", v: Math.abs(data.rotation.z) }
      ];
      const max = axes.reduce((a, b) => b.v > a.v ? b : a);
      const t = { x: 0, y: 0, z: 0 };
      const r = { x: 0, y: 0, z: 0 };
      if (max.g === "t") t[max.k] = data.translation[max.k];
      else r[max.k] = data.rotation[max.k];
      data = { ...data, translation: t, rotation: r };
    }
    const device = this.knownDevices.get(deviceId);
    const deviceRoutes = this.resolveRoutes(deviceId, device);
    data = applyRoutes(data, deviceRoutes, cfg.scale);
    return data;
  }
  /** Get the effective routes for a device: device config override > device axes metadata > global default */
  resolveRoutes(deviceId, device) {
    const devCfg = this._config.devices[deviceId];
    if (devCfg?.routes && Array.isArray(devCfg.routes)) return devCfg.routes;
    for (const [pattern, cfg] of Object.entries(this._config.devices)) {
      if (pattern.endsWith("*") && deviceId.startsWith(pattern.slice(0, -1))) {
        if (cfg.routes && Array.isArray(cfg.routes)) return cfg.routes;
      }
    }
    if (device?.axes) return buildRoutes(device.axes);
    return DEFAULT_ROUTES;
  }
  /** Dispatch KeyboardEvents for button routes matching this button event */
  dispatchButtonKeys(event) {
    if (typeof document === "undefined") return;
    const allRoutes = this.collectButtonRoutes();
    for (const route of allRoutes) {
      if (route.button === event.button) {
        document.dispatchEvent(new KeyboardEvent(
          event.pressed ? "keydown" : "keyup",
          { key: route.key, code: route.code ?? "", bubbles: true }
        ));
      }
    }
  }
  /** Gather all button routes from global config + all device configs */
  collectButtonRoutes() {
    const routes = [...this._config.buttonRoutes];
    for (const devCfg of Object.values(this._config.devices)) {
      if (devCfg.buttonRoutes) routes.push(...devCfg.buttonRoutes);
    }
    return routes;
  }
};

// packages/client/src/elements/registry.ts
var globalManager = null;
var listeners = /* @__PURE__ */ new Set();
function registerSatMouse(manager2) {
  globalManager = manager2;
  for (const fn of listeners) fn(manager2);
  listeners.clear();
}
function onManager(fn) {
  if (globalManager) fn(globalManager);
  else listeners.add(fn);
  return () => listeners.delete(fn);
}

// packages/client/src/elements/satmouse-status.ts
var TEMPLATE = `
<style>
  :host { display: inline-flex; align-items: center; gap: 8px; font-family: inherit; font-size: 13px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #e74c3c; transition: background 0.3s; }
  .dot[data-state="connected"] { background: #2ecc71; }
  .dot[data-state="connecting"] { background: #f39c12; }
  .dot[data-state="failed"] { background: #e74c3c; }
  .protocol { color: #7f8c8d; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
  .launch { padding: 4px 12px; background: #2980b9; color: #fff; border-radius: 4px; font-size: 11px;
            text-decoration: none; cursor: pointer; border: none; font-family: inherit; display: none; }
  .launch:hover { background: #3498db; }

</style>
<span class="dot"></span>
<span class="text">Disconnected</span>
<span class="protocol"></span>
<button class="launch">Launch SatMouse</button>
`;
var SatMouseStatus = class extends HTMLElement {
  dot;
  text;
  proto;
  launch;
  manager = null;
  unsub = null;
  pollTimer = null;
  stateHandler = (state, protocol) => this.update(state, protocol);
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = TEMPLATE;
    this.dot = shadow.querySelector(".dot");
    this.text = shadow.querySelector(".text");
    this.proto = shadow.querySelector(".protocol");
    this.launch = shadow.querySelector(".launch");
    this.launch.addEventListener("click", () => {
      this.startLaunchFlow();
    });
  }
  connectedCallback() {
    this.unsub = onManager((mgr) => this.bind(mgr));
    this.stopPoll();
    this.launch.disabled = false;
    this.launch.textContent = "Launch SatMouse";
  }
  disconnectedCallback() {
    this.stopPoll();
    this.unsub?.();
    this.unbind();
  }
  bind(mgr) {
    this.unbind();
    this.manager = mgr;
    mgr.on("stateChange", this.stateHandler);
    this.update(mgr.state, mgr.protocol);
  }
  unbind() {
    this.manager?.off("stateChange", this.stateHandler);
    this.manager = null;
  }
  update(state, protocol) {
    this.dot.dataset.state = state;
    this.proto.textContent = protocol !== "none" ? protocol : "";
    if (state === "connected") {
      this.stopPoll();
      this.showDownload = false;
      this.text.textContent = "Connected";
      this.launch.style.display = "none";
    } else if (state === "connecting") {
      this.text.textContent = "Connecting...";
      this.launch.style.display = "none";
    } else if (state === "failed") {
      this.text.textContent = "Not running";
      this.launch.style.display = "inline-block";
      this.launch.disabled = false;
      this.launch.textContent = this.showDownload ? "Download SatMouse" : "Launch SatMouse";
    } else {
      this.text.textContent = "Disconnected";
      this.launch.style.display = "none";
    }
  }
  showDownload = false;
  startLaunchFlow() {
    if (this.showDownload) {
      window.location.href = "https://github.com/kelnishi/SatMouse/releases/latest";
      return;
    }
    this.launch.textContent = "Connecting...";
    this.launch.disabled = true;
    this.manager?.retry();
    window.location.href = "satmouse://launch";
    let attempts = 0;
    this.stopPoll();
    this.pollTimer = setInterval(() => {
      attempts++;
      if (this.manager?.state === "connected") {
        this.stopPoll();
        this.showDownload = false;
        return;
      }
      if (attempts >= 5) {
        this.stopPoll();
        this.showDownload = true;
        this.launch.disabled = false;
        this.launch.textContent = "Download SatMouse";
        return;
      }
      this.manager?.retry();
    }, 1500);
  }
  stopPoll() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
};
customElements.define("satmouse-status", SatMouseStatus);

// packages/client/src/elements/satmouse-devices.ts
var STYLES = `
<style>
  :host { display: block; font-family: inherit; font-size: 12px; }
  .panel { background: #0f3460; border: 1px solid #1a4a8a; border-radius: 6px; padding: 10px; margin-bottom: 8px; }
  summary { cursor: pointer; font-weight: 600; color: #e0e0e0; font-size: 13px; }
  .type { font-size: 10px; color: #7f8c8d; text-transform: uppercase; margin-left: 6px; }
  .controls { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .slider-row { display: flex; align-items: center; gap: 6px; }
  .slider-row label { color: #7f8c8d; font-weight: 600; width: 38px; flex-shrink: 0; }
  .slider-row input[type="range"] { flex: 1; min-width: 0; height: 4px; accent-color: #3498db; }
  .slider-row span { color: #7f8c8d; font-family: monospace; font-size: 10px; min-width: 44px; text-align: right; }
  .route-group { display: flex; flex-wrap: wrap; gap: 4px 12px; }
  .route-row { display: flex; gap: 4px; align-items: center; }
  .route-row label { color: #7f8c8d; white-space: nowrap; }
  .route-row select { background: #16213e; color: #e0e0e0; border: 1px solid #1a4a8a; border-radius: 3px;
                      font-size: 11px; padding: 1px 4px; }
  .route-row input[type="checkbox"] { accent-color: #e74c3c; margin: 0; }
  .empty { color: #7f8c8d; font-style: italic; }
  .reset-btn { background: none; border: 1px solid #1a4a8a; border-radius: 3px; color: #7f8c8d;
               font-size: 11px; padding: 3px 8px; cursor: pointer; margin-top: 4px; }
  .reset-btn:hover { color: #e0e0e0; border-color: #e74c3c; }
  .btn-section { display: flex; flex-direction: column; gap: 4px; }
  .btn-section-label { color: #7f8c8d; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .btn-route { display: flex; gap: 6px; align-items: center; font-size: 11px; }
  .btn-route .btn-idx { color: #7f8c8d; font-family: monospace; min-width: 32px; }
  .btn-route .btn-arrow { color: #7f8c8d; }
  .btn-route .btn-key { color: #3498db; font-family: monospace; }
  .btn-route .btn-remove { cursor: pointer; color: #e74c3c; background: none; border: none;
                           font-size: 11px; padding: 0 2px; font-family: inherit; }
  .btn-route .btn-remove:hover { color: #ff6b6b; }
  .btn-add { background: none; border: 1px dashed #1a4a8a; border-radius: 3px; color: #7f8c8d;
             font-size: 11px; padding: 4px 8px; cursor: pointer; font-family: inherit; }
  .btn-add:hover { color: #e0e0e0; border-color: #3498db; }
  .btn-add.listening { color: #f39c12; border-color: #f39c12; border-style: solid; cursor: default; }
</style>
`;
function mapSlider(v) {
  return 1e-4 * Math.pow(500, v / 100);
}
function unmapSlider(v) {
  return 100 * Math.log(v / 1e-4) / Math.log(500);
}
var SatMouseDevices = class extends HTMLElement {
  manager = null;
  container;
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = STYLES + `<div class="container"><span class="empty">No devices</span></div>`;
    this.container = shadow.querySelector(".container");
  }
  unsub = null;
  deviceStatusHandler = (event, device) => {
    if (event === "connected") this.addDevice(device);
    else this.removeDevice(device);
  };
  stateHandler = (state) => {
    if (state === "connected") {
      this.manager?.fetchDeviceInfo().then((devices) => devices.forEach((d) => this.addDevice(d)));
    }
  };
  connectedCallback() {
    this.unsub = onManager((mgr) => this.bind(mgr));
  }
  disconnectedCallback() {
    this.unsub?.();
    this.unbind();
    this.container.innerHTML = `<span class="empty">No devices</span>`;
  }
  bind(mgr) {
    this.unbind();
    this.manager = mgr;
    mgr.on("deviceStatus", this.deviceStatusHandler);
    mgr.on("stateChange", this.stateHandler);
    if (mgr.state === "connected") {
      mgr.fetchDeviceInfo().then((devices) => devices.forEach((d) => this.addDevice(d)));
    }
  }
  unbind() {
    if (this.manager) {
      this.manager.off("deviceStatus", this.deviceStatusHandler);
      this.manager.off("stateChange", this.stateHandler);
      this.manager = null;
    }
  }
  addDevice(device) {
    const existing = this.shadowRoot.getElementById(`dev-${device.id}`);
    if (existing) {
      this.refreshControls(existing, device);
      return;
    }
    const empty = this.container.querySelector(".empty");
    if (empty) empty.remove();
    const panel = document.createElement("details");
    panel.className = "panel";
    panel.id = `dev-${device.id}`;
    panel.open = true;
    const summary = document.createElement("summary");
    summary.innerHTML = `${device.model ?? device.name}<span class="type">${device.connectionType ?? ""}</span>`;
    panel.appendChild(summary);
    this.refreshControls(panel, device);
    this.container.appendChild(panel);
  }
  refreshControls(panel, device) {
    const old = panel.querySelector(".controls");
    if (old) old.remove();
    const mgr = this.manager;
    const cfg = mgr.getDeviceConfig(device.id);
    const controls = document.createElement("div");
    controls.className = "controls";
    const routeGroup = document.createElement("div");
    routeGroup.className = "route-group";
    const deviceAxes = device.axes ?? ["tx", "ty", "tz", "rx", "ry", "rz"];
    const routes = this.getRoutes(device.id, deviceAxes);
    for (let i = 0; i < deviceAxes.length; i++) {
      const route = routes[i] ?? { source: deviceAxes[i], target: deviceAxes[i].replace(/[+-]$/, "") };
      const row = document.createElement("div");
      row.className = "route-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = route.flip ?? false;
      cb.title = "Flip";
      const routeIndex = i;
      cb.addEventListener("change", () => {
        this.updateRoute(device.id, routeIndex, deviceAxes, { flip: cb.checked });
      });
      row.appendChild(cb);
      const label = document.createElement("label");
      label.textContent = device.axisLabels?.[i] ?? deviceAxes[i].toUpperCase();
      row.appendChild(label);
      const sel = document.createElement("select");
      for (const target of FULL_AXES) {
        const opt = document.createElement("option");
        opt.value = target;
        opt.textContent = target.toUpperCase();
        if (target === route.target) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => {
        this.updateRoute(device.id, routeIndex, deviceAxes, { target: sel.value });
      });
      row.appendChild(sel);
      routeGroup.appendChild(row);
    }
    controls.appendChild(routeGroup);
    const sensRow = document.createElement("div");
    sensRow.className = "slider-row";
    const currentScale = cfg.scale ?? mgr.config.scale;
    sensRow.innerHTML = `<label>Scale</label><input type="range" min="0" max="100" value="${Math.round(unmapSlider(currentScale))}"><span>${currentScale.toFixed(4)}</span>`;
    const slider = sensRow.querySelector("input");
    const span = sensRow.querySelector("span");
    slider.addEventListener("input", () => {
      const v = mapSlider(+slider.value);
      span.textContent = v.toFixed(4);
      mgr.updateDeviceConfig(device.id, { scale: v });
    });
    controls.appendChild(sensRow);
    const btnSection = document.createElement("div");
    btnSection.className = "btn-section";
    const btnLabel = document.createElement("div");
    btnLabel.className = "btn-section-label";
    btnLabel.textContent = "Button Mappings";
    btnSection.appendChild(btnLabel);
    const buttonRoutes = cfg.buttonRoutes ?? [];
    for (let i = 0; i < buttonRoutes.length; i++) {
      const route = buttonRoutes[i];
      const row = document.createElement("div");
      row.className = "btn-route";
      row.innerHTML = `<span class="btn-idx">Btn ${route.button}</span><span class="btn-arrow">\u2192</span><span class="btn-key">${route.key}</span>`;
      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-remove";
      removeBtn.textContent = "\xD7";
      removeBtn.title = "Remove";
      const routeIdx = i;
      removeBtn.addEventListener("click", () => {
        const current = mgr.getDeviceConfig(device.id).buttonRoutes ?? [];
        const updated = current.filter((_, j) => j !== routeIdx);
        mgr.updateDeviceConfig(device.id, { buttonRoutes: updated });
        this.refreshControls(panel, device);
      });
      row.appendChild(removeBtn);
      btnSection.appendChild(row);
    }
    const addBtn = document.createElement("button");
    addBtn.className = "btn-add";
    addBtn.textContent = "+ Add Button Mapping";
    addBtn.addEventListener("click", () => {
      if (addBtn.classList.contains("listening")) return;
      this.startButtonListen(addBtn, mgr, device, panel);
    });
    btnSection.appendChild(addBtn);
    controls.appendChild(btnSection);
    const resetBtn = document.createElement("button");
    resetBtn.className = "reset-btn";
    resetBtn.textContent = "Restore Defaults";
    resetBtn.addEventListener("click", () => {
      mgr.resetDeviceConfig(device.id);
      this.refreshControls(panel, device);
    });
    controls.appendChild(resetBtn);
    panel.appendChild(controls);
  }
  getRoutes(deviceId, deviceAxes) {
    const mgr = this.manager;
    const devCfg = mgr.config.devices[deviceId];
    if (devCfg?.routes && Array.isArray(devCfg.routes)) return devCfg.routes;
    for (const [pattern, cfg] of Object.entries(mgr.config.devices)) {
      if (pattern.endsWith("*") && deviceId.startsWith(pattern.slice(0, -1))) {
        if (cfg.routes && Array.isArray(cfg.routes)) return cfg.routes;
      }
    }
    return buildRoutes(deviceAxes);
  }
  updateRoute(deviceId, index, deviceAxes, patch) {
    const base = this.getRoutes(deviceId, deviceAxes);
    const updated = base.map((r, j) => j === index ? { ...r, ...patch } : { ...r });
    this.manager.updateDeviceConfig(deviceId, { routes: updated });
  }
  startButtonListen(btn, mgr, device, panel) {
    btn.classList.add("listening");
    btn.textContent = "Press a device button...";
    const onButton = (event) => {
      if (!event.pressed) return;
      mgr.off("buttonEvent", onButton);
      const capturedButton = event.button;
      btn.textContent = `Btn ${capturedButton} \u2192 Press a key...`;
      const onKey = (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener("keydown", onKey, true);
        const route = {
          button: capturedButton,
          key: e.key,
          code: e.code
        };
        const current = mgr.getDeviceConfig(device.id).buttonRoutes ?? [];
        const updated = current.filter((r) => r.button !== capturedButton);
        updated.push(route);
        mgr.updateDeviceConfig(device.id, { buttonRoutes: updated });
        this.refreshControls(panel, device);
      };
      document.addEventListener("keydown", onKey, true);
    };
    mgr.on("buttonEvent", onButton);
    const onCancel = (e) => {
      if (e.key === "Escape") {
        mgr.off("buttonEvent", onButton);
        document.removeEventListener("keydown", onCancel, true);
        btn.classList.remove("listening");
        btn.textContent = "+ Add Button Mapping";
      }
    };
    document.addEventListener("keydown", onCancel, true);
  }
  removeDevice(device) {
    this.shadowRoot.getElementById(`dev-${device.id}`)?.remove();
    if (this.container.children.length === 0) {
      this.container.innerHTML = `<span class="empty">No devices</span>`;
    }
  }
};
customElements.define("satmouse-devices", SatMouseDevices);

// packages/client/src/elements/satmouse-debug.ts
var TEMPLATE2 = `
<style>
  :host { display: block; font-family: monospace; font-size: 12px; }
  .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .label { color: #7f8c8d; font-weight: 600; width: 28px; }
  .value { color: #3498db; text-align: right; min-width: 50px; }
  .meta { color: #7f8c8d; font-size: 11px; padding: 2px 0; }
</style>
<div class="meta"><span class="state">Disconnected</span> \xB7 <span class="protocol"></span> \xB7 <span class="fps">0</span> fps</div>
<div class="row"><span class="label">TX</span><span class="value" id="tx">0</span></div>
<div class="row"><span class="label">TY</span><span class="value" id="ty">0</span></div>
<div class="row"><span class="label">TZ</span><span class="value" id="tz">0</span></div>
<div class="row"><span class="label">RX</span><span class="value" id="rx">0</span></div>
<div class="row"><span class="label">RY</span><span class="value" id="ry">0</span></div>
<div class="row"><span class="label">RZ</span><span class="value" id="rz">0</span></div>
`;
var SatMouseDebug = class extends HTMLElement {
  els = {};
  frameCount = 0;
  fpsInterval = null;
  manager = null;
  unsub = null;
  spatialHandler = (data) => {
    this.frameCount++;
    this.els.tx.textContent = String(Math.round(data.translation.x));
    this.els.ty.textContent = String(Math.round(data.translation.y));
    this.els.tz.textContent = String(Math.round(data.translation.z));
    this.els.rx.textContent = String(Math.round(data.rotation.x));
    this.els.ry.textContent = String(Math.round(data.rotation.y));
    this.els.rz.textContent = String(Math.round(data.rotation.z));
  };
  stateHandler = (state, protocol) => {
    this.els.state.textContent = state;
    this.els.protocol.textContent = protocol !== "none" ? protocol : "";
  };
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = TEMPLATE2;
    for (const id of ["tx", "ty", "tz", "rx", "ry", "rz"]) {
      this.els[id] = shadow.getElementById(id);
    }
    this.els.state = shadow.querySelector(".state");
    this.els.protocol = shadow.querySelector(".protocol");
    this.els.fps = shadow.querySelector(".fps");
  }
  connectedCallback() {
    this.unsub = onManager((mgr) => this.bind(mgr));
    this.fpsInterval = setInterval(() => {
      this.els.fps.textContent = String(this.frameCount);
      this.frameCount = 0;
    }, 1e3);
  }
  disconnectedCallback() {
    this.unsub?.();
    this.unbind();
    if (this.fpsInterval) {
      clearInterval(this.fpsInterval);
      this.fpsInterval = null;
    }
  }
  bind(mgr) {
    this.unbind();
    this.manager = mgr;
    mgr.on("rawSpatialData", this.spatialHandler);
    mgr.on("stateChange", this.stateHandler);
    this.els.state.textContent = mgr.state;
    this.els.protocol.textContent = mgr.protocol !== "none" ? mgr.protocol : "";
  }
  unbind() {
    if (this.manager) {
      this.manager.off("rawSpatialData", this.spatialHandler);
      this.manager.off("stateChange", this.stateHandler);
      this.manager = null;
    }
  }
};
customElements.define("satmouse-debug", SatMouseDebug);

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
var connection = new SatMouseConnection();
var manager = new InputManager();
manager.addConnection(connection);
registerSatMouse(manager);
var iconDot = document.querySelector("#satmouse-icon .icon-dot");
if (iconDot) {
  const colors = { connected: "#2ecc71", connecting: "#f39c12", failed: "#e74c3c", disconnected: "#e74c3c" };
  manager.on("stateChange", (state) => {
    iconDot.style.background = colors[state] ?? "#e74c3c";
  });
}
var canvas = document.getElementById("canvas");
init(canvas);
var lockOrbit = false;
manager.onSpatialData((data) => {
  applyFrame(data, lockOrbit);
});
var buttonLog = document.getElementById("button-log");
manager.onButtonEvent((data) => {
  const entry = document.createElement("div");
  entry.className = `log-entry ${data.pressed ? "pressed" : "released"}`;
  entry.textContent = `btn ${data.button} ${data.pressed ? "pressed" : "released"}`;
  buttonLog.insertBefore(entry, buttonLog.firstChild);
  while (buttonLog.children.length > 50) {
    buttonLog.removeChild(buttonLog.lastChild);
  }
});
var btnReset = document.getElementById("btn-reset");
var btnLockPos = document.getElementById("btn-lock-pos");
var btnLockRot = document.getElementById("btn-lock-rot");
var btnLockOrbit = document.getElementById("btn-lock-orbit");
var btnDominant = document.getElementById("btn-dominant");
btnReset.addEventListener("click", () => {
  reset();
  manager.resetAllConfig();
});
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
connection.connect();
