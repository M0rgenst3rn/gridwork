#!/bin/bash
# Installs MS Grids via Adobe's own plugin installer (UPIA),
# so Creative Cloud knows the plugin and doesn't drop it from the list again.
# Restart Photoshop afterwards: Plugins > MS Grids.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"

rm -f "$HERE/dist/MS-Grids.ccx"
mkdir -p "$HERE/dist"
(cd "$HERE/grids" && zip -qr "$HERE/dist/MS-Grids.ccx" . -x '.*')

# only remove if already installed (otherwise the installer hangs)
# (the InDesign version is called "MS Grids for InDesign" and is left alone)
if "$UPIA" --list all 2>/dev/null | grep "MS Grids" | grep -vq "InDesign"; then
  "$UPIA" --remove "MS Grids" >/dev/null 2>&1 || true
fi
"$UPIA" --install "$HERE/dist/MS-Grids.ccx"
echo "Done. Restart Photoshop > Plugins > MS Grids"
