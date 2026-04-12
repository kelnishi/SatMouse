import { onManagerReady } from "./registry.js";
import type { InputManager } from "../utils/input-manager.js";
import type { SpatialData, ConnectionState, TransportProtocol } from "../core/types.js";

const TEMPLATE = `
<style>
  :host { display: block; font-family: monospace; font-size: 12px; }
  .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .label { color: #7f8c8d; font-weight: 600; width: 28px; }
  .value { color: #3498db; text-align: right; min-width: 50px; }
  .meta { color: #7f8c8d; font-size: 11px; padding: 2px 0; }
</style>
<div class="meta"><span class="state">Disconnected</span> · <span class="protocol"></span> · <span class="fps">0</span> fps</div>
<div class="row"><span class="label">TX</span><span class="value" id="tx">0</span></div>
<div class="row"><span class="label">TY</span><span class="value" id="ty">0</span></div>
<div class="row"><span class="label">TZ</span><span class="value" id="tz">0</span></div>
<div class="row"><span class="label">RX</span><span class="value" id="rx">0</span></div>
<div class="row"><span class="label">RY</span><span class="value" id="ry">0</span></div>
<div class="row"><span class="label">RZ</span><span class="value" id="rz">0</span></div>
`;

export class SatMouseDebug extends HTMLElement {
  private els: Record<string, HTMLElement> = {};
  private frameCount = 0;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = TEMPLATE;
    for (const id of ["tx", "ty", "tz", "rx", "ry", "rz"]) {
      this.els[id] = shadow.getElementById(id)!;
    }
    this.els.state = shadow.querySelector(".state")!;
    this.els.protocol = shadow.querySelector(".protocol")!;
    this.els.fps = shadow.querySelector(".fps")!;
  }

  connectedCallback() {
    onManagerReady((manager) => this.bind(manager));
  }

  private bind(manager: InputManager): void {
    manager.on("rawSpatialData", (data: SpatialData) => {
      this.frameCount++;
      this.els.tx.textContent = String(Math.round(data.translation.x));
      this.els.ty.textContent = String(Math.round(data.translation.y));
      this.els.tz.textContent = String(Math.round(data.translation.z));
      this.els.rx.textContent = String(Math.round(data.rotation.x));
      this.els.ry.textContent = String(Math.round(data.rotation.y));
      this.els.rz.textContent = String(Math.round(data.rotation.z));
    });

    manager.on("stateChange", (state: ConnectionState, protocol: TransportProtocol) => {
      this.els.state.textContent = state;
      this.els.protocol.textContent = protocol !== "none" ? protocol : "";
    });

    setInterval(() => {
      this.els.fps.textContent = String(this.frameCount);
      this.frameCount = 0;
    }, 1000);
  }
}

customElements.define("satmouse-debug", SatMouseDebug);
