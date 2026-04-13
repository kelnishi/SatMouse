// SatMouse Extension — Background
console.log("[SatMouse] Background loaded");

browser.runtime.onConnect.addListener(function(port) {
  console.log("[SatMouse] Port connected:", port.name);
  port.postMessage({ type: "connected" });
});
