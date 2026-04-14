#!/usr/bin/env bash
#
# SatMouse Linux installer
#
# Installs the bridge to ~/.local/share/satmouse/ and sets up a
# systemd user service for auto-start on login.
#
# Usage: bash install.sh
#
set -euo pipefail

INSTALL_DIR="${HOME}/.local/share/satmouse"
SERVICE_DIR="${HOME}/.config/systemd/user"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/scalable/apps"

# Resolve the directory this script lives in (the extracted tarball)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "SatMouse Linux Installer"
echo "========================"
echo ""
echo "Install directory: ${INSTALL_DIR}"
echo ""

# Stop existing service if running
if systemctl --user is-active satmouse >/dev/null 2>&1; then
  echo "Stopping existing SatMouse service..."
  systemctl --user stop satmouse
fi

# Create directories
mkdir -p "${INSTALL_DIR}" "${SERVICE_DIR}" "${DESKTOP_DIR}" "${ICON_DIR}"

# Copy bridge files
echo "Installing bridge files..."
cp "${SCRIPT_DIR}/node" "${INSTALL_DIR}/node"
chmod +x "${INSTALL_DIR}/node"
cp "${SCRIPT_DIR}/main.cjs" "${INSTALL_DIR}/main.cjs"

# Copy profiles if present
if [ -d "${SCRIPT_DIR}/profiles" ]; then
  cp -R "${SCRIPT_DIR}/profiles" "${INSTALL_DIR}/profiles"
fi

# Copy native modules if present
if [ -d "${SCRIPT_DIR}/node_modules" ]; then
  cp -R "${SCRIPT_DIR}/node_modules" "${INSTALL_DIR}/node_modules"
fi

# Copy package.json if present (for version detection)
if [ -f "${SCRIPT_DIR}/package.json" ]; then
  cp "${SCRIPT_DIR}/package.json" "${INSTALL_DIR}/package.json"
fi

# Install icon
if [ -f "${SCRIPT_DIR}/SatMouse.svg" ]; then
  cp "${SCRIPT_DIR}/SatMouse.svg" "${ICON_DIR}/satmouse.svg"
fi

# Install systemd service
echo "Installing systemd user service..."
cp "${SCRIPT_DIR}/satmouse.service" "${SERVICE_DIR}/satmouse.service"

# Install desktop entry
echo "Installing desktop entry..."
cp "${SCRIPT_DIR}/satmouse.desktop" "${DESKTOP_DIR}/satmouse.desktop"

# Reload systemd and enable
systemctl --user daemon-reload
systemctl --user enable satmouse

echo ""
echo "Installation complete."
echo ""
echo "Commands:"
echo "  systemctl --user start satmouse     Start the bridge"
echo "  systemctl --user stop satmouse      Stop the bridge"
echo "  systemctl --user restart satmouse   Restart (rescan devices)"
echo "  systemctl --user status satmouse    Check status"
echo "  journalctl --user -u satmouse -f    View logs"
echo ""
echo "The bridge will start automatically on login."
echo ""

# Start now
read -rp "Start SatMouse now? [Y/n] " answer
if [[ "${answer:-Y}" =~ ^[Yy]$ ]]; then
  systemctl --user start satmouse
  echo "SatMouse started. Web client: http://127.0.0.1:18945/client/"
fi
