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
var DEFAULT_ACTION_MAP = {
  tx: { source: "tx" },
  ty: { source: "ty" },
  tz: { source: "tz" },
  rx: { source: "rx" },
  ry: { source: "ry" },
  rz: { source: "rz" }
};
function readAxis(data, axis) {
  switch (axis) {
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
  }
}
function applyActionMap(data, map) {
  const result = {};
  for (const [action, binding] of Object.entries(map)) {
    let value = readAxis(data, binding.source);
    if (binding.invert) value = -value;
    value *= binding.scale ?? 1;
    result[action] = value;
  }
  return result;
}
function actionValuesToSpatialData(values, timestamp) {
  return {
    translation: {
      x: values.tx ?? 0,
      y: values.ty ?? 0,
      z: values.tz ?? 0
    },
    rotation: {
      x: values.rx ?? 0,
      y: values.ry ?? 0,
      z: values.rz ?? 0
    },
    timestamp
  };
}

// packages/client/src/utils/config.ts
var DEFAULT_CONFIG = {
  sensitivity: { translation: 1e-3, rotation: 1e-3 },
  flip: { tx: false, ty: false, tz: false, rx: false, ry: false, rz: false },
  deadZone: 0,
  dominant: false,
  axisRemap: { tx: "x", ty: "y", tz: "z", rx: "x", ry: "y", rz: "z" },
  lockPosition: false,
  lockRotation: false,
  actionMap: { ...DEFAULT_ACTION_MAP },
  devices: {
    // SpaceMouse Z-up → Three.js Y-up axis correction
    "cnx-*": { flip: { ty: true, tz: true, ry: true, rz: true } }
  }
};
function mergeConfig(base, partial) {
  const merged = {
    ...base,
    ...partial,
    sensitivity: { ...base.sensitivity, ...partial.sensitivity },
    flip: { ...base.flip, ...partial.flip },
    axisRemap: { ...base.axisRemap, ...partial.axisRemap },
    actionMap: partial.actionMap ? { ...base.actionMap, ...partial.actionMap } : { ...base.actionMap },
    devices: { ...base.devices }
  };
  if (partial.devices) {
    for (const [key, devCfg] of Object.entries(partial.devices)) {
      merged.devices[key] = mergeDeviceConfig(merged.devices[key], devCfg);
    }
  }
  return merged;
}
function mergeDeviceConfig(base, partial) {
  if (!base) return partial;
  return {
    ...base,
    ...partial,
    sensitivity: partial.sensitivity ? { ...base.sensitivity, ...partial.sensitivity } : base.sensitivity,
    flip: partial.flip ? { ...base.flip, ...partial.flip } : base.flip,
    axisRemap: partial.axisRemap ? { ...base.axisRemap, ...partial.axisRemap } : base.axisRemap
  };
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
    sensitivity: { ...config.sensitivity, ...deviceOverride.sensitivity },
    flip: { ...config.flip, ...deviceOverride.flip },
    deadZone: deviceOverride.deadZone ?? config.deadZone,
    dominant: deviceOverride.dominant ?? config.dominant,
    axisRemap: { ...config.axisRemap, ...deviceOverride.axisRemap },
    actionMap: deviceOverride.actionMap ? { ...config.actionMap, ...deviceOverride.actionMap } : config.actionMap,
    lockPosition: deviceOverride.lockPosition ?? config.lockPosition,
    lockRotation: deviceOverride.lockRotation ?? config.lockRotation
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
  knownDevices = /* @__PURE__ */ new Map();
  // Per-device accumulators: latest value from each device per frame tick
  deviceAccumulators = /* @__PURE__ */ new Map();
  accDirty = false;
  flushTimer = null;
  _config;
  get config() {
    return this._config;
  }
  constructor(config, storage) {
    super();
    this.storage = storage;
    const persisted = loadSettings(storage);
    this._config = mergeConfig(DEFAULT_CONFIG, { ...config, ...persisted });
    this.flushTimer = setInterval(() => this.flushAccumulator(), 16);
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
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
  /** Fetch device info from all connections */
  async fetchDeviceInfo() {
    const results = await Promise.all(this.connections.map((c) => c.fetchDeviceInfo()));
    const devices = results.flat();
    for (const d of devices) this.knownDevices.set(d.id, d);
    return devices;
  }
  /** Get all known connected devices paired with their resolved config */
  getDevicesWithConfig() {
    return Array.from(this.knownDevices.values()).map((device) => ({
      device,
      config: this.getDeviceConfig(device.id)
    }));
  }
  /** Get the resolved per-device config (global defaults + device overrides) */
  getDeviceConfig(deviceId) {
    const resolved = resolveDeviceConfig(this._config, deviceId);
    return {
      sensitivity: resolved.sensitivity,
      flip: resolved.flip,
      deadZone: resolved.deadZone,
      dominant: resolved.dominant,
      axisRemap: resolved.axisRemap,
      actionMap: resolved.actionMap,
      lockPosition: resolved.lockPosition,
      lockRotation: resolved.lockRotation
    };
  }
  /** Update global configuration. Persists by default. */
  updateConfig(partial, persist = true) {
    this._config = mergeConfig(this._config, partial);
    if (persist) saveSettings(this._config, this.storage);
    this.emit("configChange", this._config);
  }
  /** Update configuration for a specific device. Persists by default. */
  updateDeviceConfig(deviceId, partial, persist = true) {
    const existing = this._config.devices[deviceId] ?? {};
    this._config = mergeConfig(this._config, {
      devices: { [deviceId]: { ...existing, ...partial } }
    });
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
  /** Register a callback for action values. Returns unsubscribe function. */
  onActionValues(callback) {
    this.on("actionValues", callback);
    return () => this.off("actionValues", callback);
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
    connection2.on("buttonEvent", (event) => this.emit("buttonEvent", event));
    connection2.on("stateChange", (state, proto) => this.emit("stateChange", state, proto));
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
    const data = {
      translation: { x: merged.tx, y: merged.ty, z: merged.tz },
      rotation: { x: merged.rx, y: merged.ry, z: merged.rz },
      timestamp: performance.now() * 1e3
    };
    const { spatial, actions } = this.applyGlobalTransforms(data);
    if (spatial) this.emit("spatialData", spatial);
    if (actions) this.emit("actionValues", actions);
  }
  /** Per-device transforms: flip, sensitivity, dead zone, dominant, axis remap */
  processPerDevice(raw, deviceId) {
    const cfg = resolveDeviceConfig(this._config, deviceId);
    let data = raw;
    if (cfg.deadZone > 0) data = applyDeadZone(data, cfg.deadZone);
    if (cfg.dominant) data = applyDominant(data);
    data = applyFlip(data, cfg.flip);
    data = applyAxisRemap(data, cfg.axisRemap);
    data = applySensitivity(data, cfg.sensitivity);
    return data;
  }
  /** Global transforms applied after per-device merge: locks + action map */
  applyGlobalTransforms(data) {
    const cfg = this._config;
    if (cfg.lockPosition) {
      data = { ...data, translation: { x: 0, y: 0, z: 0 } };
    }
    if (cfg.lockRotation) {
      data = { ...data, rotation: { x: 0, y: 0, z: 0 } };
    }
    const actions = applyActionMap(data, cfg.actionMap);
    const spatial = actionValuesToSpatialData(actions, data.timestamp);
    return { spatial, actions };
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
function onManagerReady(fn) {
  if (globalManager) fn(globalManager);
  else listeners.add(fn);
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
  disconnectTimer = null;
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = TEMPLATE;
    this.dot = shadow.querySelector(".dot");
    this.text = shadow.querySelector(".text");
    this.proto = shadow.querySelector(".protocol");
    this.launch = shadow.querySelector(".launch");
    this.launch.addEventListener("click", () => {
      window.location.href = "satmouse://launch";
      setTimeout(() => {
        if (!document.hidden) {
          if (confirm("SatMouse doesn't appear to be installed. Go to the download page?")) {
            window.open("https://github.com/kelnishi/SatMouse/releases/latest", "_blank", "noopener");
          }
        }
      }, 1e3);
    });
  }
  connectedCallback() {
    this.disconnectTimer = setTimeout(() => {
      this.launch.style.display = "inline-block";
    }, 3e3);
    onManagerReady((manager2) => this.bind(manager2));
  }
  bind(manager2) {
    manager2.on("stateChange", (state, protocol) => {
      this.dot.dataset.state = state;
      this.proto.textContent = protocol !== "none" ? protocol : "";
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }
      if (state === "connected") {
        this.text.textContent = "Connected";
        this.launch.style.display = "none";
      } else if (state === "connecting") {
        this.text.textContent = "Connecting...";
        this.launch.style.display = "none";
      } else if (state === "failed") {
        this.text.textContent = "Not running";
        this.launch.style.display = "inline-block";
      } else {
        this.text.textContent = "Disconnected";
        this.launch.style.display = "none";
      }
    });
  }
};
customElements.define("satmouse-status", SatMouseStatus);

// packages/client/src/elements/satmouse-devices.ts
var AXES = ["tx", "ty", "tz", "rx", "ry", "rz"];
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
  .flip-group { display: flex; flex-direction: column; gap: 4px; }
  .flip-row { display: flex; gap: 8px; }
  .flip-row label { display: flex; align-items: center; gap: 2px; color: #7f8c8d; min-width: 36px; }
  .flip-row input { accent-color: #e74c3c; }
  .remap-group { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 8px; }
  .remap-row { display: flex; gap: 4px; align-items: center; }
  .remap-row label { color: #7f8c8d; width: 24px; flex-shrink: 0; }
  .remap-row select { background: #16213e; color: #e0e0e0; border: 1px solid #1a4a8a; border-radius: 3px;
                       font-size: 11px; padding: 1px 4px; flex: 1; min-width: 0; }
  .empty { color: #7f8c8d; font-style: italic; }
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
  connectedCallback() {
    onManagerReady((manager2) => {
      this.manager = manager2;
      manager2.on("deviceStatus", (event, device) => {
        if (event === "connected") this.addDevice(device);
        else this.removeDevice(device);
      });
      manager2.on("stateChange", (state) => {
        if (state === "connected") {
          manager2.fetchDeviceInfo().then((devices) => devices.forEach((d) => this.addDevice(d)));
        }
      });
    });
  }
  addDevice(device) {
    if (this.shadowRoot.getElementById(`dev-${device.id}`)) return;
    const empty = this.container.querySelector(".empty");
    if (empty) empty.remove();
    const mgr = this.manager;
    const cfg = mgr.getDeviceConfig(device.id);
    const panel = document.createElement("details");
    panel.className = "panel";
    panel.id = `dev-${device.id}`;
    panel.open = true;
    const summary = document.createElement("summary");
    summary.innerHTML = `${device.model ?? device.name}<span class="type">${device.connectionType ?? ""}</span>`;
    panel.appendChild(summary);
    const controls = document.createElement("div");
    controls.className = "controls";
    for (const type of ["translation", "rotation"]) {
      const row = document.createElement("div");
      row.className = "slider-row";
      const val = cfg.sensitivity?.[type] ?? mgr.config.sensitivity[type];
      row.innerHTML = `<label>${type === "translation" ? "Trans" : "Rot"}</label><input type="range" min="0" max="100" value="${Math.round(unmapSlider(val))}"><span>${val.toFixed(4)}</span>`;
      const slider = row.querySelector("input");
      const span = row.querySelector("span");
      slider.addEventListener("input", () => {
        const v = mapSlider(+slider.value);
        span.textContent = v.toFixed(4);
        mgr.updateDeviceConfig(device.id, {
          sensitivity: { ...mgr.getDeviceConfig(device.id).sensitivity, [type]: v }
        });
      });
      controls.appendChild(row);
    }
    const flipGroup = document.createElement("div");
    flipGroup.className = "flip-group";
    for (const group of [["tx", "ty", "tz"], ["rx", "ry", "rz"]]) {
      const row = document.createElement("div");
      row.className = "flip-row";
      for (const axis of group) {
        const label = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = cfg.flip?.[axis] ?? mgr.config.flip[axis];
        cb.addEventListener("change", () => {
          mgr.updateDeviceConfig(device.id, {
            flip: { ...mgr.getDeviceConfig(device.id).flip, [axis]: cb.checked }
          });
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(axis.toUpperCase()));
        row.appendChild(label);
      }
      flipGroup.appendChild(row);
    }
    controls.appendChild(flipGroup);
    const remapGroup = document.createElement("div");
    remapGroup.className = "remap-group";
    const actionMap = cfg.actionMap ?? mgr.config.actionMap;
    for (const action of AXES) {
      const row = document.createElement("div");
      row.className = "remap-row";
      row.innerHTML = `<label>${action.toUpperCase()}</label>`;
      const sel = document.createElement("select");
      for (const src of AXES) {
        const opt = document.createElement("option");
        opt.value = src;
        opt.textContent = src.toUpperCase();
        if (actionMap[action]?.source === src) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => {
        const current = mgr.getDeviceConfig(device.id).actionMap ?? { ...DEFAULT_ACTION_MAP };
        current[action] = { ...current[action], source: sel.value };
        mgr.updateDeviceConfig(device.id, { actionMap: current });
      });
      row.appendChild(sel);
      remapGroup.appendChild(row);
    }
    controls.appendChild(remapGroup);
    panel.appendChild(controls);
    this.container.appendChild(panel);
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
    onManagerReady((manager2) => this.bind(manager2));
  }
  bind(manager2) {
    manager2.on("rawSpatialData", (data) => {
      this.frameCount++;
      this.els.tx.textContent = String(Math.round(data.translation.x));
      this.els.ty.textContent = String(Math.round(data.translation.y));
      this.els.tz.textContent = String(Math.round(data.translation.z));
      this.els.rx.textContent = String(Math.round(data.rotation.x));
      this.els.ry.textContent = String(Math.round(data.rotation.y));
      this.els.rz.textContent = String(Math.round(data.rotation.z));
    });
    manager2.on("stateChange", (state, protocol) => {
      this.els.state.textContent = state;
      this.els.protocol.textContent = protocol !== "none" ? protocol : "";
    });
    setInterval(() => {
      this.els.fps.textContent = String(this.frameCount);
      this.frameCount = 0;
    }, 1e3);
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
connection.connect();
