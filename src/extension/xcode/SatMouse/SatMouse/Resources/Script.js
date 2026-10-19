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
// installed | disabled | missing | unknown, from the bridge reading Rotatrix's config
var rotatrixProfile = null;
var profileImportUrl = null;
var profileInstallStarted = false;

function setControlToken(token) {
    controlToken = token;
}

function pollActivation() {
    fetch("http://127.0.0.1:18945/api/openaxis")
        .then(function(r) { return r.json(); })
        .then(function(d) {
            setActivationState(d.activation);
            profileImportUrl = d.importUrl || null;
            if (d.profile !== rotatrixProfile) {
                rotatrixProfile = d.profile;
                if (rotatrixProfile === "installed") profileInstallStarted = false;
                pollDevices();
            }
        })
        .catch(function() {});
}

// Opens Rotatrix's import review; the user finishes there, and the next poll
// sees the profile in Rotatrix's config and swaps this for the toggle
function installProfile() {
    if (!profileImportUrl) return;
    profileInstallStarted = true;
    webkit.messageHandlers.controller.postMessage("open-url:" + profileImportUrl);
    pollDevices();
}

function profileControl() {
    var el = document.createElement("div");
    el.className = "profile-install";
    if (rotatrixProfile === "disabled") {
        el.textContent = "Profile disabled";
        el.title = "Turn the satmouse profile back on in the device's configuration (Config → Profiles).";
        return el;
    }
    if (profileInstallStarted) {
        var hint = document.createElement("span");
        hint.textContent = "Finish in the window that opened: Import profile, then Apply";
        el.appendChild(hint);
    }
    var b = document.createElement("button");
    b.textContent = profileInstallStarted ? "Open again" : "Install profile";
    b.title = "Adds SatMouse's profile to the device's configuration, which it needs to send 3D input to SatMouse pages.";
    b.disabled = !profileImportUrl;
    b.addEventListener("click", installProfile);
    el.appendChild(b);
    return el;
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
        // OpenAxis devices (Rotatrix) get the activation toggle on their status
        // line once the SatMouse profile is installed, and the install offer until then
        if (String(d.id).indexOf("oax-") === 0 && rotatrixProfile !== null) {
            var control = rotatrixProfile === "installed" ? activationToggle() : profileControl();
            row.insertBefore(control, row.lastChild);
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
