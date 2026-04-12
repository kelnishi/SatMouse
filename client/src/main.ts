import { SatMouseConnection } from "../../packages/client/src/core/index.js";
import { InputManager } from "../../packages/client/src/utils/index.js";
import { registerSatMouse } from "../../packages/client/src/elements/index.js";
import type { SpatialData, ButtonEvent } from "../../packages/client/src/core/types.js";
import type { InputConfig } from "../../packages/client/src/utils/config.js";
import { init, applyFrame, reset } from "./cube.js";

// ---- SDK setup ----
const connection = new SatMouseConnection();
const manager = new InputManager();
manager.addConnection(connection);

// Register manager for Web Components (<satmouse-status>, <satmouse-devices>, <satmouse-debug>)
registerSatMouse(manager);

// ---- 3D scene ----
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
init(canvas);

let lockOrbit = false;

// ---- Spatial data ----
manager.onSpatialData((data: SpatialData) => {
  applyFrame(data, lockOrbit);
});

// ---- Button events ----
const buttonLog = document.getElementById("button-log")!;
manager.onButtonEvent((data: ButtonEvent) => {
  const entry = document.createElement("div");
  entry.className = `log-entry ${data.pressed ? "pressed" : "released"}`;
  entry.textContent = `btn ${data.button} ${data.pressed ? "pressed" : "released"}`;
  buttonLog.insertBefore(entry, buttonLog.firstChild);
  while (buttonLog.children.length > 50) {
    buttonLog.removeChild(buttonLog.lastChild!);
  }
});

// ---- Controls ----
const btnReset = document.getElementById("btn-reset")!;
const btnLockPos = document.getElementById("btn-lock-pos")!;
const btnLockRot = document.getElementById("btn-lock-rot")!;
const btnLockOrbit = document.getElementById("btn-lock-orbit")!;
const btnDominant = document.getElementById("btn-dominant")!;

btnReset.addEventListener("click", reset);

function toggleButton(btn: HTMLElement, key: keyof InputConfig) {
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

// ---- Connect ----
connection.connect();
