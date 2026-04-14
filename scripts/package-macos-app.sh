#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="22.16.0"
XCODE_PROJECT="src/extension/xcode/SatMouse/SatMouse.xcodeproj"
APP="dist/SatMouse.app"

echo "=== Packaging SatMouse.app ==="

# Sync version from package.json into extension manifest + Xcode Info.plist
PKG_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf-8')).version)")
echo "  Version: $PKG_VERSION"

# Update extension manifest version
if [ -f "src/extension/safari/manifest.json" ]; then
  node -e "
    const m = JSON.parse(require('fs').readFileSync('src/extension/safari/manifest.json','utf-8'));
    m.version = '$PKG_VERSION';
    require('fs').writeFileSync('src/extension/safari/manifest.json', JSON.stringify(m, null, 2) + '\n');
  "
  # Also update in the Xcode project copy
  EXT_RES="src/extension/xcode/SatMouse/SatMouse Extension/Resources/manifest.json"
  [ -f "$EXT_RES" ] && cp src/extension/safari/manifest.json "$EXT_RES"
fi

# Update Xcode app version to match package.json
XCODE_PLIST="src/extension/xcode/SatMouse/SatMouse/Info.plist"
if [ -f "$XCODE_PLIST" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $PKG_VERSION" "$XCODE_PLIST" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $PKG_VERSION" "$XCODE_PLIST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $PKG_VERSION" "$XCODE_PLIST" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $PKG_VERSION" "$XCODE_PLIST"
fi

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
    *) echo "Unsupported arch: $ARCH"; exit 1 ;;
  esac
  mkdir -p dist
  curl -sL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz" \
    | tar xz --strip-components=2 -C dist/ "node-v${NODE_VERSION}-darwin-${NODE_ARCH}/bin/node"
  mv dist/node dist/node-official
  NODE_BIN="dist/node-official"
fi

# Step 2: Build Swift app + extension via Xcode
echo "Building with Xcode..."
TEAM_ID="${APPLE_TEAM_ID:-QVJ72LNVSK}"

# Clean previous build
rm -rf src/extension/xcode/build

# In CI (no Mac Development cert), skip Xcode signing — the release
# workflow re-signs everything with a Developer ID cert afterward.
# Locally, use Automatic signing with the developer's team ID.
XCODE_COMMON_ARGS=(
  -project "$XCODE_PROJECT"
  -scheme "SatMouse" -configuration Release
  -derivedDataPath src/extension/xcode/build
  MARKETING_VERSION="$PKG_VERSION"
  CURRENT_PROJECT_VERSION="$PKG_VERSION"
  -quiet
)

if [ -n "${CI:-}" ]; then
  xcodebuild "${XCODE_COMMON_ARGS[@]}" \
    CODE_SIGN_IDENTITY="-" \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGNING_ALLOWED=NO \
    2>&1 || { echo "Xcode build failed"; exit 1; }
else
  xcodebuild "${XCODE_COMMON_ARGS[@]}" \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    CODE_SIGN_STYLE="Automatic" \
    2>&1 || { echo "Xcode build failed"; exit 1; }
fi

# Step 3: Copy Xcode output
rm -rf "$APP"
cp -R "src/extension/xcode/build/Build/Products/Release/SatMouse.app" "$APP"
RESOURCES="$APP/Contents/Resources"

# Step 4: Add Node + resources
echo "Adding resources..."
mkdir -p "$RESOURCES/bin"
cp "$NODE_BIN" "$RESOURCES/bin/node"
chmod +x "$RESOURCES/bin/node"

cp dist/main.js "$RESOURCES/main.cjs"
cp -R src/devices/plugins/hid/profiles "$RESOURCES/profiles"
[ -f "assets/icons/SatMouse.icns" ] && cp assets/icons/SatMouse.icns "$RESOURCES/SatMouse.icns"
cp package.json "$RESOURCES/"

mkdir -p "$RESOURCES/node_modules"
[ -d "node_modules/koffi" ] && cp -R node_modules/koffi "$RESOURCES/node_modules/"
[ -d "node_modules/@fails-components" ] && { mkdir -p "$RESOURCES/node_modules/@fails-components"; cp -R node_modules/@fails-components "$RESOURCES/node_modules/"; }
[ -d "node_modules/node-hid" ] && cp -R node_modules/node-hid "$RESOURCES/node_modules/"

mkdir -p "$RESOURCES/client"
cp client/index.html client/style.css client/main.js "$RESOURCES/client/" 2>/dev/null || true
[ -d "specs" ] && cp -R specs "$RESOURCES/specs"

if [ -f "src/extension/native-messaging-host.js" ]; then
  npx esbuild src/extension/native-messaging-host.js \
    --bundle --platform=node --format=cjs \
    --external:bufferutil --external:utf-8-validate \
    --outfile="$RESOURCES/native-messaging-host.cjs" 2>/dev/null
  printf '#!/bin/bash\nDIR="$(cd "$(dirname "$0")" && pwd)"\nexec "$DIR/bin/node" "$DIR/native-messaging-host.cjs"\n' > "$RESOURCES/native-messaging-host"
  chmod +x "$RESOURCES/native-messaging-host"
  cp src/extension/com.kelnishi.SatMouse.json "$RESOURCES/" 2>/dev/null || true
fi

# Step 5: Re-sign everything with the SAME identity Xcode used
echo "Re-signing..."

# Get the signing identity from the Xcode-built main binary
IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | grep "Apple Development" | head -1 | awk '{print $2}' || true)
if [ -z "$IDENTITY" ]; then
  echo "  Warning: No signing identity found, using ad-hoc"
  IDENTITY="-"
fi

# Entitlements files
APP_ENTITLEMENTS="src/extension/xcode/SatMouse/SatMouse/SatMouse.entitlements"
EXT_ENTITLEMENTS="scripts/entitlements-extension.plist"

# Inside-out signing: innermost first, parent bundle last.
# Never use --deep — it flattens entitlements and breaks the .appex.

# 1. Sign native .node addons
find "$RESOURCES/node_modules" -name "*.node" -exec codesign --force --sign "$IDENTITY" {} \; 2>/dev/null || true

# 2. Sign Node binary (needs USB, network, bluetooth, JIT)
codesign --force --sign "$IDENTITY" \
  --entitlements "$APP_ENTITLEMENTS" \
  "$RESOURCES/bin/node" 2>/dev/null || true

# 3. Sign the .appex with its own entitlements (sandbox + network.client)
codesign --force --sign "$IDENTITY" \
  --entitlements "$EXT_ENTITLEMENTS" \
  "$APP/Contents/PlugIns/SatMouse Extension.appex" 2>/dev/null || true

# 4. Sign the parent .app last
codesign --force --sign "$IDENTITY" \
  --entitlements "$APP_ENTITLEMENTS" \
  "$APP" 2>/dev/null || true

# Verify
echo "Verifying..."
codesign --verify --deep "$APP" 2>&1 && echo "  Signature valid" || echo "  WARNING: Signature invalid"

# Clean Xcode build artifacts (prevents Safari from picking up stale extensions)
rm -rf src/extension/xcode/build ~/Library/Developer/Xcode/DerivedData/SatMouse-*

# Register with Launch Services
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" 2>/dev/null || true

echo "=== Created $APP ==="
