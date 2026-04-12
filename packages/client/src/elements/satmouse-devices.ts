import { onManagerReady } from "./registry.js";
import type { InputManager } from "../utils/input-manager.js";
import type { DeviceInfo } from "../core/types.js";
import type { InputAxis, AxisRoute } from "../utils/action-map.js";
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

  connectedCallback() {
    onManagerReady((manager) => {
      this.manager = manager;
      manager.on("deviceStatus", (event, device) => {
        if (event === "connected") this.addDevice(device);
        else this.removeDevice(device);
      });
      manager.on("stateChange", (state) => {
        if (state === "connected") {
          manager.fetchDeviceInfo().then((devices) => devices.forEach((d) => this.addDevice(d)));
        }
      });
    });
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

    // Scale slider
    const sensRow = document.createElement("div");
    sensRow.className = "slider-row";
    const currentScale = cfg.scale ?? mgr.config.scale;
    sensRow.innerHTML = `<label>Scale</label>` +
      `<input type="range" min="0" max="100" value="${Math.round(unmapSlider(currentScale))}">` +
      `<span>${currentScale.toFixed(4)}</span>`;
    const slider = sensRow.querySelector("input")! as HTMLInputElement;
    const span = sensRow.querySelector("span")!;
    slider.addEventListener("input", () => {
      const v = mapSlider(+slider.value);
      span.textContent = v.toFixed(4);
      mgr.updateDeviceConfig(device.id, { scale: v });
    });
    controls.appendChild(sensRow);

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

  private removeDevice(device: DeviceInfo): void {
    this.shadowRoot!.getElementById(`dev-${device.id}`)?.remove();
    if (this.container.children.length === 0) {
      this.container.innerHTML = `<span class="empty">No devices</span>`;
    }
  }
}

customElements.define("satmouse-devices", SatMouseDevices);
