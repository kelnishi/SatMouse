import { onManager } from "./registry.js";
import { t } from "./locale.js";
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
<div class="meta"><span class="state"></span> · <span class="protocol"></span> · <span class="fps">0</span> <span class="fps-label"></span></div>
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
  private fpsInterval: ReturnType<typeof setInterval> | null = null;
  private manager: InputManager | null = null;
  private unsub: (() => void) | null = null;

  private spatialHandler = (data: SpatialData) => {
    this.frameCount++;
    this.els.tx.textContent = String(Math.round(data.translation.x));
    this.els.ty.textContent = String(Math.round(data.translation.y));
    this.els.tz.textContent = String(Math.round(data.translation.z));
    this.els.rx.textContent = String(Math.round(data.rotation.x));
    this.els.ry.textContent = String(Math.round(data.rotation.y));
    this.els.rz.textContent = String(Math.round(data.rotation.z));
  };

  private stateHandler = (state: ConnectionState, protocol: TransportProtocol) => {
    this.els.state.textContent = state;
    this.els.protocol.textContent = protocol !== "none" ? protocol : "";
  };

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
    this.els.state.textContent = t("disconnected");
    shadow.querySelector(".fps-label")!.textContent = t("fps");
  }

  connectedCallback() {
    this.unsub = onManager((mgr) => this.bind(mgr));
    this.fpsInterval = setInterval(() => {
      this.els.fps.textContent = String(this.frameCount);
      this.frameCount = 0;
    }, 1000);
  }

  disconnectedCallback() {
    this.unsub?.();
    this.unbind();
    if (this.fpsInterval) {
      clearInterval(this.fpsInterval);
      this.fpsInterval = null;
    }
  }

  private bind(mgr: InputManager): void {
    this.unbind();
    this.manager = mgr;
    mgr.on("rawSpatialData", this.spatialHandler);
    mgr.on("stateChange", this.stateHandler);
    this.els.state.textContent = mgr.state;
    this.els.protocol.textContent = mgr.protocol !== "none" ? mgr.protocol : "";
  }

  private unbind(): void {
    if (this.manager) {
      this.manager.off("rawSpatialData", this.spatialHandler);
      this.manager.off("stateChange", this.stateHandler);
      this.manager = null;
    }
  }
}

customElements.define("satmouse-debug", SatMouseDebug);
