#!/usr/bin/env bash
set -euo pipefail

# Creates SatMouse.app bundle:
# 1. Stage Node.js + JS bundles + resources into the Xcode project's Resources
# 2. Build everything via Xcode (signs the complete bundle in one pass)

NODE_VERSION="22.16.0"
XCODE_PROJECT="src/extension/xcode/SatMouse/SatMouse.xcodeproj"
XCODE_RESOURCES="src/extension/xcode/SatMouse/SatMouse/Resources"
APP="dist/SatMouse.app"

echo "=== Packaging SatMouse.app ==="

# Step 1: Get Node.js binary
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

# Step 2: Stage everything into Xcode Resources (before build)
echo "Staging resources..."

# Node binary
mkdir -p "$XCODE_RESOURCES/bin"
cp "$NODE_BIN" "$XCODE_RESOURCES/bin/node"
chmod +x "$XCODE_RESOURCES/bin/node"

# Sign Node with entitlements before Xcode build
cat > /tmp/satmouse-node.entitlements << 'ENTITLEMENTS'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key><true/>
    <key>com.apple.security.network.server</key><true/>
    <key>com.apple.security.network.client</key><true/>
    <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>
ENTITLEMENTS
codesign --force --sign - --entitlements /tmp/satmouse-node.entitlements "$XCODE_RESOURCES/bin/node"
rm -f /tmp/satmouse-node.entitlements

# JS bundles
cp dist/main.js "$XCODE_RESOURCES/main.cjs"

# HID device profiles
rm -rf "$XCODE_RESOURCES/profiles"
cp -R src/devices/plugins/hid/profiles "$XCODE_RESOURCES/profiles"

# App icon
if [ -f "assets/icons/SatMouse.icns" ]; then
  cp assets/icons/SatMouse.icns "$XCODE_RESOURCES/SatMouse.icns"
fi

# Native addons
mkdir -p "$XCODE_RESOURCES/node_modules"
[ -d "node_modules/koffi" ] && cp -R node_modules/koffi "$XCODE_RESOURCES/node_modules/"
[ -d "node_modules/@fails-components" ] && { mkdir -p "$XCODE_RESOURCES/node_modules/@fails-components"; cp -R node_modules/@fails-components "$XCODE_RESOURCES/node_modules/"; }
[ -d "node_modules/node-hid" ] && cp -R node_modules/node-hid "$XCODE_RESOURCES/node_modules/"

# Sign native addon .node files
find "$XCODE_RESOURCES/node_modules" -name "*.node" -exec codesign --force --sign - {} \; 2>/dev/null || true

# Package.json
cp package.json "$XCODE_RESOURCES/"

# Client files
mkdir -p "$XCODE_RESOURCES/client"
cp client/index.html "$XCODE_RESOURCES/client/" 2>/dev/null || true
cp client/style.css "$XCODE_RESOURCES/client/" 2>/dev/null || true
cp client/main.js "$XCODE_RESOURCES/client/" 2>/dev/null || true
[ -d "specs" ] && { rm -rf "$XCODE_RESOURCES/specs"; cp -R specs "$XCODE_RESOURCES/specs"; }

# Native messaging host
if [ -f "src/extension/native-messaging-host.js" ]; then
  npx esbuild src/extension/native-messaging-host.js \
    --bundle --platform=node --format=cjs \
    --external:bufferutil --external:utf-8-validate \
    --outfile="$XCODE_RESOURCES/native-messaging-host.cjs" 2>/dev/null
  cat > "$XCODE_RESOURCES/native-messaging-host" << 'LAUNCHER'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/bin/node" "$DIR/native-messaging-host.cjs"
LAUNCHER
  chmod +x "$XCODE_RESOURCES/native-messaging-host"
  cp src/extension/com.kelnishi.SatMouse.json "$XCODE_RESOURCES/" 2>/dev/null || true
fi

echo "  Resources staged"

# Step 3: Build via Xcode (signs everything in one pass)
echo "Building with Xcode..."
TEAM_ID="${APPLE_TEAM_ID:-QVJ72LNVSK}"

xcodebuild -project "$XCODE_PROJECT" \
  -scheme "SatMouse" -configuration Release \
  -derivedDataPath src/extension/xcode/build \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE="Automatic" \
  -quiet 2>&1 || { echo "Xcode build failed"; exit 1; }

# Step 4: Copy the complete signed .app
rm -rf "$APP"
cp -R "src/extension/xcode/build/Build/Products/Release/SatMouse.app" "$APP"

# Clean staged resources from Xcode project (don't commit them)
rm -rf "$XCODE_RESOURCES/bin" "$XCODE_RESOURCES/main.cjs" "$XCODE_RESOURCES/profiles" \
  "$XCODE_RESOURCES/node_modules" "$XCODE_RESOURCES/package.json" "$XCODE_RESOURCES/client" \
  "$XCODE_RESOURCES/specs" "$XCODE_RESOURCES/native-messaging-host"* \
  "$XCODE_RESOURCES/com.kelnishi.SatMouse.json" "$XCODE_RESOURCES/SatMouse.icns"

# Register with Launch Services
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" 2>/dev/null || true

echo "=== Created $APP ==="
echo "  Signed by Xcode (no post-build re-signing)"
echo "  Extension: $APP/Contents/PlugIns/SatMouse Extension.appex"
