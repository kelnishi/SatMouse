#!/bin/bash
set -e

# Build the Safari Web Extension .appex bundle
# This compiles the Swift handler and packages the web extension files.

APPEX="$1"
if [ -z "$APPEX" ]; then
  echo "Usage: $0 <output.appex>"
  exit 1
fi

SRC_DIR="src/extension/safari"
BUNDLE_ID="com.kelnishi.SatMouse.Extension"

# Create .appex bundle structure
rm -rf "$APPEX"
mkdir -p "$APPEX/Contents/MacOS"
mkdir -p "$APPEX/Contents/Resources"

# Copy Info.plist
cp "$SRC_DIR/Info.plist" "$APPEX/Contents/"

# Compile Swift handler
swiftc -o "$APPEX/Contents/MacOS/SatMouse Extension" \
  -module-name SatMouse_Extension \
  -framework SafariServices \
  -framework Foundation \
  -target arm64-apple-macos11.0 \
  -O \
  "$SRC_DIR/SafariWebExtensionHandler.swift"

echo "Compiled Swift extension handler"

# Copy web extension resources
cp "$SRC_DIR/manifest.json" "$APPEX/Contents/Resources/"
cp "$SRC_DIR/background.js" "$APPEX/Contents/Resources/"

# Copy icon from assets if available
if [ -f "assets/icons/SatMouse.svg" ]; then
  # Convert SVG to PNG for extension icon (if sips can handle it)
  # For now, copy the 1024 PNG and let macOS scale it
  if [ -f "assets/icons/SatMouse-Default-1024x1024@1x.png" ]; then
    sips -z 48 48 "assets/icons/SatMouse-Default-1024x1024@1x.png" \
      --out "$APPEX/Contents/Resources/icon-48.png" 2>/dev/null || true
    sips -z 128 128 "assets/icons/SatMouse-Default-1024x1024@1x.png" \
      --out "$APPEX/Contents/Resources/icon-128.png" 2>/dev/null || true
  fi
fi

echo "Built $APPEX"
