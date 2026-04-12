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
cp src/devices/plugins/hid/profiles.json "$APP/Contents/Resources/profiles.json"

# Compile a native launcher that execs node with the tray wrapper.
# This is CFBundleExecutable — macOS tracks it for menu bar identity.
# Fork-based launcher: parent stays alive as the macOS-tracked app process,
# child runs node with the tray wrapper. This ensures the window server
# associates the NSStatusItem with the .app bundle (execv doesn't work
# because macOS already tracked the pre-exec process identity).
cat > /tmp/satmouse_launcher.c << 'CSRC'
#include <stdlib.h>
#include <unistd.h>
#include <string.h>
#include <stdio.h>
#include <mach-o/dyld.h>

// exec (not fork) so Node replaces this process and inherits the
// bundle's PID — required for macOS to deliver Apple Events (URL
// scheme, open-file, reopen) to the NSApplication in tray-wrapper.
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

    char *new_argv[] = { node_path, script_path, NULL };
    execv(node_path, new_argv);
    perror("execv");
    return 1;
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

echo "=== Created $APP ==="
echo "  Binary:   $APP/Contents/MacOS/satmouse"
echo "  Addons:   $APP/Contents/Resources/node_modules/"
echo "  LSUIElement: true (menu bar only, no dock icon)"
