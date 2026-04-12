import { onManagerReady } from "./registry.js";
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
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = TEMPLATE;
    this.dot = shadow.querySelector(".dot")!;
    this.text = shadow.querySelector(".text")!;
    this.proto = shadow.querySelector(".protocol")!;
    this.launch = shadow.querySelector(".launch")!;

    this.launch.addEventListener("click", () => {
      // Try the URL scheme — if installed, the OS opens the app
      window.location.href = "satmouse://launch";
      // If we're still here after 1s, the scheme wasn't handled
      setTimeout(() => {
        if (!document.hidden) {
          if (confirm("SatMouse doesn't appear to be installed. Go to the download page?")) {
            window.open("https://github.com/kelnishi/SatMouse/releases/latest", "_blank", "noopener");
          }
        }
      }, 1000);
    });
  }

  connectedCallback() {
    // Show launch button if still disconnected after 3s (covers cold page load)
    this.disconnectTimer = setTimeout(() => { this.launch.style.display = "inline-block"; }, 3000);
    onManagerReady((manager) => this.bind(manager));
  }

  private bind(manager: InputManager): void {
    manager.on("stateChange", (state: ConnectionState, protocol: TransportProtocol) => {
      this.dot.dataset.state = state;
      this.proto.textContent = protocol !== "none" ? protocol : "";

      if (this.disconnectTimer) { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }

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
}

customElements.define("satmouse-status", SatMouseStatus);
