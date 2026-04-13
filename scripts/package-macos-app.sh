#!/usr/bin/env bash
set -euo pipefail

# Creates SatMouse.app bundle from the SEA binary in dist/
# Usage: ./scripts/package-macos-app.sh [binary_path]

NODE_BIN="${1:-$(command -v node)}"
APP="dist/SatMouse.app"
BUNDLE_ID="com.kelnishi.SatMouse"
VERSION="${SATMOUSE_VERSION:-0.1.0}"

echo "=== Packaging SatMouse.app ==="

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

# Node binary in two locations:
# - MacOS/node: runs the tray wrapper (AppKit, owns the menu bar icon)
# - Resources/bin/node: runs the server child (3Dconnexion, transports)
cp "$NODE_BIN" "$APP/Contents/MacOS/node"
chmod +x "$APP/Contents/MacOS/node"

mkdir -p "$APP/Contents/Resources/bin"
cp "$NODE_BIN" "$APP/Contents/Resources/bin/node"
chmod +x "$APP/Contents/Resources/bin/node"

# Copy bundled JS files
cp dist/main.js "$APP/Contents/Resources/main.cjs"
cp dist/tray-wrapper.cjs "$APP/Contents/Resources/tray-wrapper.cjs"

# Copy HID device profiles
cp -R src/devices/plugins/hid/profiles "$APP/Contents/Resources/profiles"

# Copy app icon (.icns — macOS requires this format at runtime)
if [ -f "assets/icons/SatMouse.icns" ]; then
  cp assets/icons/SatMouse.icns "$APP/Contents/Resources/SatMouse.icns"
fi

# Compile a native launcher (CFBundleExecutable).
# Fork-based: parent stays alive as the macOS-tracked process (for window
# server identity and menu bar icon), child execs node with tray-wrapper.
# Direct execv doesn't work — macOS loses the GUI association after exec.
cat > /tmp/satmouse_launcher.c << 'CSRC'
#include <stdlib.h>
#include <unistd.h>
#include <string.h>
#include <stdio.h>
#include <signal.h>
#include <sys/wait.h>
#include <mach-o/dyld.h>

static pid_t child_pid = 0;
void handle_signal(int sig) { if (child_pid > 0) kill(child_pid, sig); }

int main(int argc, char *argv[]) {
    char exe[4096];
    uint32_t size = sizeof(exe);
    _NSGetExecutablePath(exe, &size);
    char resolved[4096];
    realpath(exe, resolved);
    char *last_slash = strrchr(resolved, '/');
    if (last_slash) *last_slash = '\0';

    char node_path[4096], script_path[4096];
    snprintf(node_path, sizeof(node_path), "%s/node", resolved);
    snprintf(script_path, sizeof(script_path), "%s/../Resources/tray-wrapper.cjs", resolved);

    child_pid = fork();
    if (child_pid == 0) {
        char *new_argv[] = { node_path, script_path, NULL };
        execv(node_path, new_argv);
        perror("execv");
        return 1;
    }

    signal(SIGTERM, handle_signal);
    signal(SIGINT, handle_signal);
    int status;
    waitpid(child_pid, &status, 0);
    return WEXITSTATUS(status);
}
CSRC
cc -o "$APP/Contents/MacOS/satmouse" /tmp/satmouse_launcher.c -O2
rm /tmp/satmouse_launcher.c

# Copy native addon node_modules into Resources
if [ -d "node_modules/koffi" ]; then
  echo "Bundling koffi native addon..."
  mkdir -p "$APP/Contents/Resources/node_modules"
  cp -R node_modules/koffi "$APP/Contents/Resources/node_modules/"
  # Remove non-darwin platform binaries to reduce size
  find "$APP/Contents/Resources/node_modules/koffi/build" -type d \
    ! -name "darwin_arm64" ! -name "darwin_x64" ! -name "koffi" ! -name "build" \
    -mindepth 2 -exec rm -rf {} + 2>/dev/null || true
fi

if [ -d "node_modules/@fails-components" ]; then
  echo "Bundling @fails-components native addons..."
  mkdir -p "$APP/Contents/Resources/node_modules/@fails-components"
  cp -R node_modules/@fails-components "$APP/Contents/Resources/node_modules/"
fi
if [ -d "node_modules/node-hid" ]; then
  echo "Bundling node-hid native addon..."
  cp -R node_modules/node-hid "$APP/Contents/Resources/node_modules/"
fi

# Copy package.json for version info
cp package.json "$APP/Contents/Resources/"

# Copy specs and client for the built-in web server
if [ -d "specs" ]; then
  cp -R specs "$APP/Contents/Resources/"
fi
if [ -d "client" ]; then
  mkdir -p "$APP/Contents/Resources/client"
  cp client/index.html client/style.css client/main.js "$APP/Contents/Resources/client/" 2>/dev/null || true
fi

# Info.plist
cat > "$APP/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>satmouse</string>
    <key>CFBundleIconFile</key>
    <string>SatMouse</string>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}</string>
    <key>CFBundleName</key>
    <string>SatMouse</string>
    <key>CFBundleDisplayName</key>
    <string>SatMouse</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>CFBundleURLTypes</key>
    <array>
        <dict>
            <key>CFBundleURLName</key>
            <string>SatMouse URL Scheme</string>
            <key>CFBundleURLSchemes</key>
            <array>
                <string>satmouse</string>
            </array>
        </dict>
    </array>
</dict>
</plist>
PLIST

# PkgInfo
echo -n "APPL????" > "$APP/Contents/PkgInfo"

# Register with Launch Services (registers satmouse:// URL scheme)
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" 2>/dev/null || true

echo "=== Created $APP ==="
echo "  Binary:   $APP/Contents/MacOS/satmouse"
echo "  Addons:   $APP/Contents/Resources/node_modules/"
echo "  LSUIElement: true (menu bar only, no dock icon)"
echo "  URL scheme: satmouse://"
