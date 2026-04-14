function updateExtensionState(enabled) {
    var badge = document.getElementById("ext-badge");
    badge.textContent = enabled ? "Enabled" : "Disabled";
    badge.className = "badge " + (enabled ? "on" : "off");
}

function setVersion(version) {
    document.getElementById("version").textContent = "v" + version;
}

function esc(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
}

function updateClients(clients) {
    var list = document.getElementById("client-list");
    if (!clients || clients.length === 0) {
        list.innerHTML = '<p class="empty">No clients connected</p>';
        return;
    }
    list.innerHTML = "";
    clients.forEach(function(c) {
        var row = document.createElement("div");
        row.className = "client-row";
        var name = c.origin || c.browser || "Unknown";
        try { name = new URL(c.origin).hostname || name; } catch(e) {}
        row.innerHTML = '<div class="client-info">' +
            '<span>' + esc(name) + '</span>' +
            '<span class="transport">' + esc(c.browser || "") + '</span>' +
            (c.extension ? '<span class="ext-badge">EXT</span>' : '') +
            '</div>' +
            '<span style="color:#7f8c8d;font-size:11px">' + esc(c.transport || "") + '</span>';
        list.appendChild(row);
    });
}

// Extension settings deeplink
document.getElementById("ext-row").addEventListener("click", function() {
    webkit.messageHandlers.controller.postMessage("open-extension-settings");
});

// Project link
document.getElementById("project-link").addEventListener("click", function(e) {
    e.preventDefault();
    webkit.messageHandlers.controller.postMessage("open-project");
});

// Reference client link
document.getElementById("client-link").addEventListener("click", function(e) {
    e.preventDefault();
    webkit.messageHandlers.controller.postMessage("open-client");
});

function updateDevices(devices) {
    var list = document.getElementById("device-list");
    if (!devices || devices.length === 0) {
        list.innerHTML = '<p class="empty">No devices connected</p>';
        return;
    }
    list.innerHTML = "";
    devices.forEach(function(d) {
        var row = document.createElement("div");
        row.className = "client-row";
        var cls = d.deviceClass || "";
        row.innerHTML = '<div class="client-info">' +
            '<span>' + esc(d.name || d.model || "Unknown") + '</span>' +
            (cls ? '<span class="transport">' + esc(cls) + '</span>' : '') +
            '</div>' +
            '<span style="color:#7f8c8d;font-size:11px">' + esc(d.connectionType || "") + '</span>';
        list.appendChild(row);
    });
}

// Fetch bridge version
fetch("http://127.0.0.1:18945/health")
    .then(function(r) { return r.json(); })
    .then(function(d) { if (d.version) setVersion(d.version); })
    .catch(function() {});

// Poll connected clients every 2s
function pollClients() {
    fetch("http://127.0.0.1:18945/api/status")
        .then(function(r) { return r.json(); })
        .then(function(d) { updateClients(d.clients); })
        .catch(function() { updateClients([]); });
}
function pollDevices() {
    fetch("http://127.0.0.1:18945/api/device")
        .then(function(r) { return r.json(); })
        .then(function(d) { updateDevices(d.devices); })
        .catch(function() { updateDevices([]); });
}

pollClients();
pollDevices();
setInterval(pollClients, 2000);
setInterval(pollDevices, 3000);
