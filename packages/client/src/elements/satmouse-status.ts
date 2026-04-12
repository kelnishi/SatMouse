import { onManager } from "./registry.js";
import type { InputManager } from "../utils/input-manager.js";
import type { ConnectionState, TransportProtocol } from "../core/types.js";

const TEMPLATE = `
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

export class SatMouseStatus extends HTMLElement {
  private dot!: HTMLElement;
  private text!: HTMLElement;
  private proto!: HTMLElement;
  private launch!: HTMLButtonElement;
  private manager: InputManager | null = null;
  private unsub: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private stateHandler = (state: ConnectionState, protocol: TransportProtocol) => this.update(state, protocol);

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = TEMPLATE;
    this.dot = shadow.querySelector(".dot")!;
    this.text = shadow.querySelector(".text")!;
    this.proto = shadow.querySelector(".protocol")!;
    this.launch = shadow.querySelector(".launch")!;

    this.launch.addEventListener("click", () => {
      this.startLaunchFlow();
    });
  }

  connectedCallback() {
    this.unsub = onManager((mgr) => this.bind(mgr));
    // Reset button state on remount
    this.stopPoll();
    this.launch.disabled = false;
    this.launch.textContent = "Launch SatMouse";
  }

  disconnectedCallback() {
    this.stopPoll();
    this.unsub?.();
    this.unbind();
  }

  private bind(mgr: InputManager): void {
    this.unbind();
    this.manager = mgr;
    mgr.on("stateChange", this.stateHandler);
    this.update(mgr.state, mgr.protocol);
  }

  private unbind(): void {
    this.manager?.off("stateChange", this.stateHandler);
    this.manager = null;
  }

  private update(state: ConnectionState, protocol: TransportProtocol): void {
    this.dot.dataset.state = state;
    this.proto.textContent = protocol !== "none" ? protocol : "";

    if (state === "connected") {
      this.stopPoll();
      this.text.textContent = "Connected";
      this.launch.style.display = "none";
    } else if (state === "connecting") {
      this.text.textContent = "Connecting...";
      this.launch.style.display = "none";
    } else if (state === "failed") {
      this.text.textContent = "Not running";
      this.launch.style.display = "inline-block";
      this.launch.disabled = false;
      this.launch.textContent = "Launch SatMouse";
    } else {
      this.text.textContent = "Disconnected";
      this.launch.style.display = "none";
    }
  }

  private startLaunchFlow(): void {
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
        return;
      }
      if (attempts >= 5) {
        this.stopPoll();
        this.launch.disabled = false;
        this.launch.textContent = "Launch SatMouse";
        if (confirm("SatMouse doesn't appear to be installed. Go to the download page?")) {
          window.open("https://github.com/kelnishi/SatMouse/releases/latest", "_blank", "noopener");
        }
        return;
      }
      this.manager?.retry();
    }, 1500);
  }

  private stopPoll(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

customElements.define("satmouse-status", SatMouseStatus);
