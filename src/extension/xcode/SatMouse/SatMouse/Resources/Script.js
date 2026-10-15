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

// Rotatrix activation (hold modifier vs always 3D), set through the bridge
var controlToken = null;
var rotatrixActivation = null;

function setControlToken(token) {
    controlToken = token;
}

function pollActivation() {
    fetch("http://127.0.0.1:18945/api/openaxis")
        .then(function(r) { return r.json(); })
        .then(function(d) { setActivationState(d.activation); })
        .catch(function() {});
}

function setActivationState(activation) {
    rotatrixActivation = activation;
    var buttons = document.querySelectorAll(".activation-toggle button");
    buttons.forEach(function(b) {
        b.classList.toggle("selected", b.dataset.activation === activation);
    });
}

function chooseActivation(activation) {
    if (!controlToken || activation === rotatrixActivation) return;
    setActivationState(activation);
    fetch("http://127.0.0.1:18945/api/openaxis", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-SatMouse-Control": controlToken },
        body: JSON.stringify({ activation: activation })
    })
        .then(function(r) { return r.json(); })
        .then(function(d) { if (d.activation) setActivationState(d.activation); })
        .catch(pollActivation);
}

function activationToggle() {
    var toggle = document.createElement("div");
    toggle.className = "activation-toggle";
    toggle.title = "3D input. Hold Ctrl: hold Ctrl or button 4 for 3D. " +
        "Always: 3D while a SatMouse page has focus; hold Ctrl or button 4 for the mouse.";
    [["hold", "Hold Ctrl"], ["always", "Always"]].forEach(function(opt) {
        var b = document.createElement("button");
        b.dataset.activation = opt[0];
        b.textContent = opt[1];
        if (rotatrixActivation === opt[0]) b.className = "selected";
        b.disabled = !controlToken;
        b.addEventListener("click", function() { chooseActivation(opt[0]); });
        toggle.appendChild(b);
    });
    return toggle;
}

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
        // OpenAxis devices (Rotatrix) get the activation toggle on their status line
        if (String(d.id).indexOf("oax-") === 0) {
            row.insertBefore(activationToggle(), row.lastChild);
        }
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
pollActivation();
setInterval(pollClients, 2000);
setInterval(pollDevices, 3000);
setInterval(pollActivation, 3000);
