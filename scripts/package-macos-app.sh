#!/usr/bin/env bash
set -euo pipefail

# Creates SatMouse.app bundle from the SEA binary in dist/
# Usage: ./scripts/package-macos-app.sh [binary_path]

BINARY="${1:-dist/satmouse}"
APP="dist/SatMouse.app"
BUNDLE_ID="dev.satmouse.SatMouse"
VERSION="${SATMOUSE_VERSION:-0.1.0}"

echo "=== Packaging SatMouse.app ==="

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

# Copy binary
cp "$BINARY" "$APP/Contents/MacOS/satmouse"
chmod +x "$APP/Contents/MacOS/satmouse"

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
echo "  Binary: $APP/Contents/MacOS/satmouse"
echo "  LSUIElement: true (menu bar only, no dock icon)"
