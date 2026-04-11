#!/usr/bin/env bash
set -euo pipefail

echo "=== SatMouse SEA Build ==="

# 1. Bundle TypeScript to single JS file
echo "Bundling with esbuild..."
npx esbuild src/main.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile=dist/main.js \
  --external:koffi \
  --external:@fails-components/webtransport

# 2. Generate SEA blob
echo "Generating SEA blob..."
node --experimental-sea-config sea-config.json

# 3. Copy node binary
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
if [[ "$PLATFORM" == "darwin" ]]; then
  OUTPUT="dist/satmouse"
  cp "$(command -v node)" "$OUTPUT"
  # Remove existing signature (macOS requires this before injection)
  codesign --remove-signature "$OUTPUT" 2>/dev/null || true
elif [[ "$PLATFORM" == "linux" ]]; then
  OUTPUT="dist/satmouse"
  cp "$(command -v node)" "$OUTPUT"
else
  OUTPUT="dist/satmouse.exe"
  cp "$(command -v node)" "$OUTPUT"
fi

# 4. Inject SEA blob
echo "Injecting SEA blob..."
npx postject "$OUTPUT" NODE_SEA_BLOB dist/satmouse.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# 5. Sign on macOS
if [[ "$PLATFORM" == "darwin" ]]; then
  echo "Signing binary..."
  codesign --sign - "$OUTPUT"
fi

echo "=== Build complete: $OUTPUT ==="
