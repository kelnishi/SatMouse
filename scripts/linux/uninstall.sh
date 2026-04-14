#!/usr/bin/env bash
#
# SatMouse Linux uninstaller
#
# Stops the service, removes installed files, and cleans up.
#
# Usage: bash uninstall.sh
#
set -euo pipefail

INSTALL_DIR="${HOME}/.local/share/satmouse"
SERVICE_FILE="${HOME}/.config/systemd/user/satmouse.service"
DESKTOP_FILE="${HOME}/.local/share/applications/satmouse.desktop"
ICON_FILE="${HOME}/.local/share/icons/hicolor/scalable/apps/satmouse.svg"

echo "SatMouse Linux Uninstaller"
echo "=========================="
echo ""

# Stop and disable service
if systemctl --user is-enabled satmouse >/dev/null 2>&1; then
  echo "Stopping and disabling service..."
  systemctl --user disable --now satmouse 2>/dev/null || true
fi

# Remove files
echo "Removing files..."
[ -f "${SERVICE_FILE}" ] && rm "${SERVICE_FILE}" && echo "  Removed ${SERVICE_FILE}"
[ -f "${DESKTOP_FILE}" ] && rm "${DESKTOP_FILE}" && echo "  Removed ${DESKTOP_FILE}"
[ -f "${ICON_FILE}" ] && rm "${ICON_FILE}" && echo "  Removed ${ICON_FILE}"

if [ -d "${INSTALL_DIR}" ]; then
  rm -rf "${INSTALL_DIR}"
  echo "  Removed ${INSTALL_DIR}"
fi

systemctl --user daemon-reload

echo ""
echo "SatMouse has been uninstalled."
