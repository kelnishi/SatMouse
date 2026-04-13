/**
 * SatMouse Extension — Content Script
 *
 * Injected into web pages. Bridges between the page's JavaScript
 * and the extension's background service worker.
 *
 * The page communicates via window.postMessage, the content script
 * relays to browser.runtime via a persistent port.
 */

(function() {
  // Only activate if the page requests it
  let port = null;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.target !== "satmouse-extension") return;

    const msg = event.data;

    if (msg.action === "connect") {
      if (port) return; // Already connected
      port = browser.runtime.connect({ name: "satmouse-page" });

      port.onMessage.addListener((response) => {
        window.postMessage({
          source: "satmouse-extension",
          ...response
        }, "*");
      });

      port.onDisconnect.addListener(() => {
        port = null;
        window.postMessage({
          source: "satmouse-extension",
          type: "disconnected"
        }, "*");
      });

      // Subscribe to spatial data
      port.postMessage({ action: "subscribe" });

      window.postMessage({
        source: "satmouse-extension",
        type: "connected"
      }, "*");
    }

    if (msg.action === "disconnect") {
      if (port) { port.disconnect(); port = null; }
    }
  });

  // Announce that the extension is available (both ways)
  window.__satmouseExtensionAvailable = true;
  window.postMessage({
    source: "satmouse-extension",
    type: "available"
  }, "*");
})();
