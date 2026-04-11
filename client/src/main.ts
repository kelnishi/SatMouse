import { SatMouseConnection } from "../../packages/client/src/core/index.js";
import { InputManager } from "../../packages/client/src/utils/index.js";
import type { SpatialData, ButtonEvent, ConnectionState, TransportProtocol } from "../../packages/client/src/core/types.js";
import type { InputConfig } from "../../packages/client/src/utils/config.js";
import { init, applyFrame, reset } from "./cube.js";

// ---- DOM ----
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const statusDot = document.getElementById("status-dot")!;
const statusText = document.getElementById("status-text")!;
const protocolLabel = document.getElementById("protocol-label")!;
const buttonLog = document.getElementById("button-log")!;

const valTx = document.getElementById("val-tx")!;
const valTy = document.getElementById("val-ty")!;
const valTz = document.getElementById("val-tz")!;
const valRx = document.getElementById("val-rx")!;
const valRy = document.getElementById("val-ry")!;
const valRz = document.getElementById("val-rz")!;

const btnReset = document.getElementById("btn-reset")!;
const btnLockPos = document.getElementById("btn-lock-pos")!;
const btnLockRot = document.getElementById("btn-lock-rot")!;
const btnLockOrbit = document.getElementById("btn-lock-orbit")!;
const btnDominant = document.getElementById("btn-dominant")!;

const sliderTrans = document.getElementById("slider-trans") as HTMLInputElement;
const sliderTransVal = document.getElementById("slider-trans-val")!;
const sliderRot = document.getElementById("slider-rot") as HTMLInputElement;
const sliderRotVal = document.getElementById("slider-rot-val")!;

// ---- SDK setup ----
const connection = new SatMouseConnection();
const manager = new InputManager();
manager.addConnection(connection);

let lockOrbit = false;

// ---- 3D scene ----
init(canvas);

// ---- Spatial data ----
manager.onSpatialData((data: SpatialData) => {
  applyFrame(data, lockOrbit);
});

// Raw data for readout display
manager.on("rawSpatialData", (data: SpatialData) => {
  valTx.textContent = String(Math.round(data.translation.x));
  valTy.textContent = String(Math.round(data.translation.y));
  valTz.textContent = String(Math.round(data.translation.z));
  valRx.textContent = String(Math.round(data.rotation.x));
  valRy.textContent = String(Math.round(data.rotation.y));
  valRz.textContent = String(Math.round(data.rotation.z));
});

// ---- Button events ----
manager.onButtonEvent((data: ButtonEvent) => {
  const entry = document.createElement("div");
  entry.className = `log-entry ${data.pressed ? "pressed" : "released"}`;
  entry.textContent = `btn ${data.button} ${data.pressed ? "pressed" : "released"}`;
  buttonLog.insertBefore(entry, buttonLog.firstChild);
  while (buttonLog.children.length > 50) {
    buttonLog.removeChild(buttonLog.lastChild!);
  }
});

// ---- Connection state ----
manager.on("stateChange", (state: ConnectionState, protocol: TransportProtocol) => {
  statusDot.className = state;
  statusText.textContent =
    state === "connected" ? "Connected" : state === "connecting" ? "Connecting..." : "Disconnected";
  protocolLabel.textContent = protocol !== "none" ? protocol : "";
});

// ---- Controls ----
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

// ---- Flip checkboxes ----
document.querySelectorAll<HTMLInputElement>(".flip-cb").forEach((cb) => {
  const axis = cb.dataset.axis as keyof InputConfig["flip"];
  cb.checked = manager.config.flip[axis];
  cb.addEventListener("change", () => {
    manager.updateConfig({ flip: { ...manager.config.flip, [axis]: cb.checked } });
  });
});

// ---- Sensitivity sliders ----
function mapSlider(v: number): number {
  return 0.0001 * Math.pow(500, v / 100);
}

function unmapSlider(v: number): number {
  return (100 * Math.log(v / 0.0001)) / Math.log(500);
}

sliderTrans.value = String(Math.round(unmapSlider(manager.config.sensitivity.translation)));
sliderTransVal.textContent = manager.config.sensitivity.translation.toFixed(4);
sliderRot.value = String(Math.round(unmapSlider(manager.config.sensitivity.rotation)));
sliderRotVal.textContent = manager.config.sensitivity.rotation.toFixed(4);

sliderTrans.addEventListener("input", () => {
  const v = mapSlider(+sliderTrans.value);
  manager.updateConfig({ sensitivity: { ...manager.config.sensitivity, translation: v } });
  sliderTransVal.textContent = v.toFixed(4);
});

sliderRot.addEventListener("input", () => {
  const v = mapSlider(+sliderRot.value);
  manager.updateConfig({ sensitivity: { ...manager.config.sensitivity, rotation: v } });
  sliderRotVal.textContent = v.toFixed(4);
});

// ---- Connect ----
connection.connect();
