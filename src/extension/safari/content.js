/**
 * SatMouse Safari Extension — Content Script
 *
 * Bridges between web pages and the extension's background script.
 * The background connects to the SatMouse bridge via WebSocket
 * (extensions bypass mixed-content restrictions).
 *
 * Pages detect the extension via window.__satmouseExtensionAvailable
 * and communicate via window.postMessage.
 */

(function() {
  var port = null;

  window.addEventListener("message", function(event) {
    if (event.source !== window) return;
    if (!event.data || event.data.target !== "satmouse-extension") return;

    if (event.data.action === "connect") {
      if (port) return;
      port = browser.runtime.connect({ name: "satmouse-page" });
      port.onMessage.addListener(function(msg) {
        window.postMessage({ source: "satmouse-extension", type: msg.type, data: msg.data }, "*");
      });
      port.onDisconnect.addListener(function() {
        port = null;
        window.postMessage({ source: "satmouse-extension", type: "disconnected" }, "*");
      });
      port.postMessage({ action: "subscribe" });
    }

    if (event.data.action === "fetchDevices") {
      if (port) port.postMessage({ action: "fetchDevices" });
    }

    if (event.data.action === "disconnect") {
      if (port) { port.disconnect(); port = null; }
    }
  });

  // Inject flag into page context (content scripts are isolated)
  var s = document.createElement("script");
  s.textContent = "window.__satmouseExtensionAvailable=true;";
  (document.head || document.documentElement).appendChild(s);
  s.remove();
})();
