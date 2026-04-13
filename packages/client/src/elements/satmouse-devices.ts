import { onManager } from "./registry.js";
import type { InputManager } from "../utils/input-manager.js";
import type { DeviceInfo } from "../core/types.js";
import type { InputAxis, AxisRoute } from "../utils/action-map.js";
import type { ButtonRoute } from "../utils/config.js";
import type { ButtonEvent } from "../core/types.js";
import { FULL_AXES, buildRoutes, DEFAULT_ROUTES } from "../utils/action-map.js";

const STYLES = `
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

function mapSlider(v: number): number { return 0.0001 * Math.pow(500, v / 100); }
function unmapSlider(v: number): number { return (100 * Math.log(v / 0.0001)) / Math.log(500); }

export class SatMouseDevices extends HTMLElement {
  private manager: InputManager | null = null;
  private container!: HTMLElement;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = STYLES + `<div class="container"><span class="empty">No devices</span></div>`;
    this.container = shadow.querySelector(".container")!;
  }

  private unsub: (() => void) | null = null;

  private deviceStatusHandler = (event: "connected" | "disconnected", device: DeviceInfo) => {
    if (event === "connected") this.addDevice(device);
    else this.removeDevice(device);
  };

  private stateHandler = (state: string) => {
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

  private bind(mgr: InputManager): void {
    this.unbind();
    this.manager = mgr;
    mgr.on("deviceStatus", this.deviceStatusHandler);
    mgr.on("stateChange", this.stateHandler);
    if (mgr.state === "connected") {
      mgr.fetchDeviceInfo().then((devices) => devices.forEach((d) => this.addDevice(d)));
    }
  }

  private unbind(): void {
    if (this.manager) {
      this.manager.off("deviceStatus", this.deviceStatusHandler);
      this.manager.off("stateChange", this.stateHandler);
      this.manager = null;
    }
  }

  private addDevice(device: DeviceInfo): void {
    const existing = this.shadowRoot!.getElementById(`dev-${device.id}`);
    if (existing) {
      this.refreshControls(existing as HTMLDetailsElement, device);
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

  private refreshControls(panel: HTMLDetailsElement, device: DeviceInfo): void {
    const old = panel.querySelector(".controls");
    if (old) old.remove();

    const mgr = this.manager!;
    const cfg = mgr.getDeviceConfig(device.id);

    const controls = document.createElement("div");
    controls.className = "controls";

    // Axis routes — one row per device input: [flip] [label] → [target dropdown] [scale slider]
    const routeGroup = document.createElement("div");
    routeGroup.className = "route-group";
    const deviceAxes = device.axes ?? ["tx", "ty", "tz", "rx", "ry", "rz"];
    const routes = this.getRoutes(device.id, deviceAxes);

    for (let i = 0; i < deviceAxes.length; i++) {
      const route = routes[i] ?? { source: deviceAxes[i] as InputAxis, target: deviceAxes[i].replace(/[+-]$/, "") as InputAxis };
      const row = document.createElement("div");
      row.className = "route-row";

      // Flip checkbox
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = route.flip ?? false;
      cb.title = "Flip";
      const routeIndex = i;
      cb.addEventListener("change", () => {
        this.updateRoute(device.id, routeIndex, deviceAxes, { flip: cb.checked });
      });
      row.appendChild(cb);

      // Label (device input name)
      const label = document.createElement("label");
      label.textContent = device.axisLabels?.[i] ?? deviceAxes[i].toUpperCase();
      row.appendChild(label);

      // Target dropdown
      const sel = document.createElement("select");
      for (const target of FULL_AXES) {
        const opt = document.createElement("option");
        opt.value = target;
        opt.textContent = target.toUpperCase();
        if (target === route.target) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => {
        this.updateRoute(device.id, routeIndex, deviceAxes, { target: sel.value as InputAxis });
      });
      row.appendChild(sel);

      routeGroup.appendChild(row);
    }
    controls.appendChild(routeGroup);

    // Scale sliders
    for (const [label, key, globalKey] of [
      ["Trans", "translateScale", "translateScale"],
      ["Rot", "rotateScale", "rotateScale"],
      ["W", "wScale", "wScale"],
    ] as const) {
      const row = document.createElement("div");
      row.className = "slider-row";
      const val = (cfg as any)[key] ?? (mgr.config as any)[globalKey];
      row.innerHTML = `<label>${label}</label>` +
        `<input type="range" min="0" max="100" value="${Math.round(unmapSlider(val))}">` +
        `<span>${val.toFixed(4)}</span>`;
      const sl = row.querySelector("input")! as HTMLInputElement;
      const sp = row.querySelector("span")!;
      sl.addEventListener("input", () => {
        const v = mapSlider(+sl.value);
        sp.textContent = v.toFixed(4);
        mgr.updateDeviceConfig(device.id, { [key]: v });
      });
      controls.appendChild(row);
    }

    // Button mappings
    const btnSection = document.createElement("div");
    btnSection.className = "btn-section";
    const btnLabel = document.createElement("div");
    btnLabel.className = "btn-section-label";
    btnLabel.textContent = "Button Mappings";
    btnSection.appendChild(btnLabel);

    const buttonRoutes: ButtonRoute[] = cfg.buttonRoutes ?? [];
    const labels = device.buttonLabels ?? [];
    for (let i = 0; i < buttonRoutes.length; i++) {
      const route = buttonRoutes[i];
      const btnName = labels[route.button] ?? `Btn ${route.button}`;
      const row = document.createElement("div");
      row.className = "btn-route";

      const idxSpan = document.createElement("span");
      idxSpan.className = "btn-idx";
      idxSpan.textContent = btnName;
      row.appendChild(idxSpan);

      const arrow = document.createElement("span");
      arrow.className = "btn-arrow";
      arrow.textContent = "\u2192";
      row.appendChild(arrow);

      const keySpan = document.createElement("span");
      keySpan.className = "btn-key";
      keySpan.textContent = route.key;
      row.appendChild(keySpan);

      // Edit — re-listen for a new key
      const editBtn = document.createElement("button");
      editBtn.className = "btn-remove";
      editBtn.textContent = "\u270E";
      editBtn.title = "Remap key";
      const routeIdx = i;
      editBtn.addEventListener("click", () => {
        keySpan.textContent = "Press a key...";
        keySpan.style.color = "#f39c12";
        const onKey = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          document.removeEventListener("keydown", onKey, true);
          const current = mgr.getDeviceConfig(device.id).buttonRoutes ?? [];
          const updated = current.map((r: ButtonRoute, j: number) =>
            j === routeIdx ? { ...r, key: e.key, code: e.code } : r
          );
          mgr.updateDeviceConfig(device.id, { buttonRoutes: updated });
          this.refreshControls(panel, device);
        };
        document.addEventListener("keydown", onKey, true);
      });
      row.appendChild(editBtn);

      // Delete
      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-remove";
      removeBtn.textContent = "\u00d7";
      removeBtn.title = "Remove";
      removeBtn.addEventListener("click", () => {
        const current = mgr.getDeviceConfig(device.id).buttonRoutes ?? [];
        const updated = current.filter((_: ButtonRoute, j: number) => j !== routeIdx);
        mgr.updateDeviceConfig(device.id, { buttonRoutes: updated });
        this.refreshControls(panel, device);
      });
      row.appendChild(removeBtn);
      btnSection.appendChild(row);
    }

    // Add mapping button with listen flow
    const addBtn = document.createElement("button");
    addBtn.className = "btn-add";
    addBtn.textContent = "+ Add Button Mapping";
    addBtn.addEventListener("click", () => {
      if (addBtn.classList.contains("listening")) return;
      this.startButtonListen(addBtn, mgr, device, panel);
    });
    btnSection.appendChild(addBtn);
    controls.appendChild(btnSection);

    // Reset button
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

  private getRoutes(deviceId: string, deviceAxes: string[]): AxisRoute[] {
    // Only use saved device config routes — not the global fallback
    const mgr = this.manager!;
    const devCfg = mgr.config.devices[deviceId];
    if (devCfg?.routes && Array.isArray(devCfg.routes)) return devCfg.routes;

    // Check pattern matches
    for (const [pattern, cfg] of Object.entries(mgr.config.devices)) {
      if (pattern.endsWith("*") && deviceId.startsWith(pattern.slice(0, -1))) {
        if (cfg.routes && Array.isArray(cfg.routes)) return cfg.routes;
      }
    }

    // Build from device axes
    return buildRoutes(deviceAxes);
  }

  private updateRoute(deviceId: string, index: number, deviceAxes: string[], patch: Partial<AxisRoute>): void {
    const base = this.getRoutes(deviceId, deviceAxes);
    const updated = base.map((r, j) => j === index ? { ...r, ...patch } : { ...r });
    this.manager!.updateDeviceConfig(deviceId, { routes: updated });
  }

  private startButtonListen(
    btn: HTMLButtonElement,
    mgr: InputManager,
    device: DeviceInfo,
    panel: HTMLDetailsElement,
  ): void {
    btn.classList.add("listening");
    btn.textContent = "Press a device button...";

    // Step 1: Listen for device button
    const onButton = (event: ButtonEvent) => {
      if (!event.pressed) return; // only on press, not release
      mgr.off("buttonEvent", onButton);

      const capturedButton = event.button;
      btn.textContent = `Btn ${capturedButton} \u2192 Press a key...`;

      // Step 2: Listen for keyboard key
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener("keydown", onKey, true);

        const route: ButtonRoute = {
          button: capturedButton,
          key: e.key,
          code: e.code,
        };

        const current = mgr.getDeviceConfig(device.id).buttonRoutes ?? [];
        // Replace existing mapping for the same button, or add new
        const updated = current.filter((r: ButtonRoute) => r.button !== capturedButton);
        updated.push(route);
        mgr.updateDeviceConfig(device.id, { buttonRoutes: updated });
        this.refreshControls(panel, device);
      };
      document.addEventListener("keydown", onKey, true);
    };
    mgr.on("buttonEvent", onButton);

    // Cancel on Escape (before a button is pressed)
    const onCancel = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        mgr.off("buttonEvent", onButton);
        document.removeEventListener("keydown", onCancel, true);
        btn.classList.remove("listening");
        btn.textContent = "+ Add Button Mapping";
      }
    };
    document.addEventListener("keydown", onCancel, true);
  }

  private removeDevice(device: DeviceInfo): void {
    this.shadowRoot!.getElementById(`dev-${device.id}`)?.remove();
    if (this.container.children.length === 0) {
      this.container.innerHTML = `<span class="empty">No devices</span>`;
    }
  }
}

customElements.define("satmouse-devices", SatMouseDevices);
