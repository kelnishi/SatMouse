#!/usr/bin/env bash
set -euo pipefail

# Creates SatMouse.app bundle:
# 1. Builds the Swift app + Safari extension via Xcode
# 2. Copies Node.js + JS bundles + resources into the .app

APP="dist/SatMouse.app"
NODE_VERSION="22.16.0"
XCODE_PROJECT="src/extension/xcode/SatMouse/SatMouse.xcodeproj"

echo "=== Packaging SatMouse.app ==="

# Step 1: Build the Swift app + extension via Xcode
echo "Building Swift app + Safari extension..."
xcodebuild -project "$XCODE_PROJECT" \
  -scheme "SatMouse" -configuration Release \
  -derivedDataPath src/extension/xcode/build \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_ALLOWED=YES \
  CODE_SIGN_ENTITLEMENTS="SatMouse/SatMouse.entitlements" \
  -quiet 2>&1 || { echo "Xcode build failed"; exit 1; }

# Copy Xcode output as the base .app
rm -rf "$APP"
cp -R "src/extension/xcode/build/Build/Products/Release/SatMouse.app" "$APP"

echo "  Swift app built (with Safari extension .appex)"

# Step 2: Get Node.js binary
if [ -n "${1:-}" ]; then
  NODE_BIN="$1"
elif [ -f "dist/node-official" ]; then
  NODE_BIN="dist/node-official"
else
  echo "Downloading official Node.js $NODE_VERSION..."
  ARCH=$(uname -m)
  case "$ARCH" in
    arm64|aarch64) NODE_ARCH="arm64" ;;
    x86_64|x64)    NODE_ARCH="x64" ;;
    *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
  esac
  mkdir -p dist
  curl -sL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz" \
    | tar xz --strip-components=2 -C dist/ "node-v${NODE_VERSION}-darwin-${NODE_ARCH}/bin/node"
  mv dist/node dist/node-official
  NODE_BIN="dist/node-official"
fi

# Step 3: Copy Node.js + resources into the .app
RESOURCES="$APP/Contents/Resources"
mkdir -p "$RESOURCES/bin"
cp "$NODE_BIN" "$RESOURCES/bin/node"
chmod +x "$RESOURCES/bin/node"

# Sign Node binary with entitlements (network.server for port binding, JIT for V8)
cat > /tmp/satmouse-node.entitlements << 'ENTITLEMENTS'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
ENTITLEMENTS
codesign --force --sign - --entitlements /tmp/satmouse-node.entitlements "$RESOURCES/bin/node" 2>/dev/null || true
rm -f /tmp/satmouse-node.entitlements

# JS bundles
cp dist/main.js "$RESOURCES/main.cjs"

# HID device profiles
cp -R src/devices/plugins/hid/profiles "$RESOURCES/profiles"

# App icon
if [ -f "assets/icons/SatMouse.icns" ]; then
  cp assets/icons/SatMouse.icns "$RESOURCES/SatMouse.icns"
fi

# Native modules
if [ -d "node_modules/koffi" ]; then
  echo "Bundling koffi native addon..."
  mkdir -p "$RESOURCES/node_modules"
  cp -R node_modules/koffi "$RESOURCES/node_modules/"
fi
if [ -d "node_modules/@fails-components" ]; then
  echo "Bundling @fails-components native addons..."
  mkdir -p "$RESOURCES/node_modules/@fails-components"
  cp -R node_modules/@fails-components "$RESOURCES/node_modules/"
fi
if [ -d "node_modules/node-hid" ]; then
  echo "Bundling node-hid native addon..."
  cp -R node_modules/node-hid "$RESOURCES/node_modules/"
fi

# Package.json for version info
cp package.json "$RESOURCES/"

# Client files
if [ -d "client" ]; then
  mkdir -p "$RESOURCES/client"
  cp client/index.html "$RESOURCES/client/" 2>/dev/null || true
  cp client/style.css "$RESOURCES/client/" 2>/dev/null || true
  cp client/main.js "$RESOURCES/client/" 2>/dev/null || true
fi
if [ -d "specs" ]; then
  cp -R specs "$RESOURCES/"
fi

# Certs directory
mkdir -p "$RESOURCES/certs"

# Native messaging host for Safari extension
if [ -f "src/extension/native-messaging-host.js" ]; then
  echo "Bundling native messaging host..."
  npx esbuild src/extension/native-messaging-host.js \
    --bundle --platform=node --format=cjs \
    --external:bufferutil --external:utf-8-validate \
    --outfile="$RESOURCES/native-messaging-host.cjs"
  cat > "$RESOURCES/native-messaging-host" << 'LAUNCHER'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/bin/node" "$DIR/native-messaging-host.cjs"
LAUNCHER
  chmod +x "$RESOURCES/native-messaging-host"
  cp src/extension/com.kelnishi.SatMouse.json "$RESOURCES/" 2>/dev/null || true
fi

# Register with Launch Services (satmouse:// URL scheme)
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" 2>/dev/null || true

echo "=== Created $APP ==="
echo "  Main binary: $APP/Contents/MacOS/SatMouse (Swift)"
echo "  Node.js:     $RESOURCES/bin/node"
echo "  Extension:   $APP/Contents/PlugIns/SatMouse Extension.appex"
echo "  URL scheme:  satmouse://"
