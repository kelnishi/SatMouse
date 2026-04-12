#!/usr/bin/env bash
set -euo pipefail

# Creates SatMouse.app bundle from the SEA binary in dist/
# Usage: ./scripts/package-macos-app.sh [binary_path]

BINARY="${1:-dist/satmouse}"
APP="dist/SatMouse.app"
BUNDLE_ID="com.kelnishi.SatMouse"
VERSION="${SATMOUSE_VERSION:-0.1.0}"

echo "=== Packaging SatMouse.app ==="

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

# Copy the SEA binary as the direct executable (no launcher script)
# nativeRequire() handles module resolution from Resources/node_modules
cp "$BINARY" "$APP/Contents/MacOS/satmouse"
chmod +x "$APP/Contents/MacOS/satmouse"

# Copy native addon node_modules into Resources
# These can't be embedded in the SEA blob — they must ship alongside
if [ -d "node_modules/koffi" ]; then
  echo "Bundling koffi native addon..."
  mkdir -p "$APP/Contents/Resources/node_modules"
  cp -R node_modules/koffi "$APP/Contents/Resources/node_modules/"
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
