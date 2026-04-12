import { onManagerReady } from "./registry.js";
import type { InputManager } from "../utils/input-manager.js";
import type { DeviceInfo } from "../core/types.js";
import type { InputAxis } from "../utils/action-map.js";
import { DEFAULT_ACTION_MAP } from "../utils/action-map.js";

const AXES: InputAxis[] = ["tx", "ty", "tz", "rx", "ry", "rz"];

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
    if (this.shadowRoot!.getElementById(`dev-${device.id}`)) return;
    const empty = this.container.querySelector(".empty");
    if (empty) empty.remove();

    const mgr = this.manager!;
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

    // Sensitivity sliders
    for (const type of ["translation", "rotation"] as const) {
      const row = document.createElement("div");
      row.className = "slider-row";
      const val = cfg.sensitivity?.[type] ?? mgr.config.sensitivity[type];
      row.innerHTML = `<label>${type === "translation" ? "Trans" : "Rot"}</label>` +
        `<input type="range" min="0" max="100" value="${Math.round(unmapSlider(val))}">` +
        `<span>${val.toFixed(4)}</span>`;
      const slider = row.querySelector("input")! as HTMLInputElement;
      const span = row.querySelector("span")!;
      slider.addEventListener("input", () => {
        const v = mapSlider(+slider.value);
        span.textContent = v.toFixed(4);
        mgr.updateDeviceConfig(device.id, {
          sensitivity: { ...mgr.getDeviceConfig(device.id).sensitivity, [type]: v },
        });
      });
      controls.appendChild(row);
    }

    // Flip checkboxes
    const flipGroup = document.createElement("div");
    flipGroup.className = "flip-group";
    for (const group of [["tx", "ty", "tz"], ["rx", "ry", "rz"]] as InputAxis[][]) {
      const row = document.createElement("div");
      row.className = "flip-row";
      for (const axis of group) {
        const label = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = cfg.flip?.[axis] ?? mgr.config.flip[axis];
        cb.addEventListener("change", () => {
          mgr.updateDeviceConfig(device.id, {
            flip: { ...mgr.getDeviceConfig(device.id).flip, [axis]: cb.checked },
          });
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(axis.toUpperCase()));
        row.appendChild(label);
      }
      flipGroup.appendChild(row);
    }
    controls.appendChild(flipGroup);

    // Axis remap
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
        current[action] = { ...current[action], source: sel.value as InputAxis };
        mgr.updateDeviceConfig(device.id, { actionMap: current });
      });
      row.appendChild(sel);
      remapGroup.appendChild(row);
    }
    controls.appendChild(remapGroup);

    panel.appendChild(controls);
    this.container.appendChild(panel);
  }

  private removeDevice(device: DeviceInfo): void {
    this.shadowRoot!.getElementById(`dev-${device.id}`)?.remove();
    if (this.container.children.length === 0) {
      this.container.innerHTML = `<span class="empty">No devices</span>`;
    }
  }
}

customElements.define("satmouse-devices", SatMouseDevices);
