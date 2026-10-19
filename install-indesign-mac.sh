#!/bin/bash
# Installs Gridwork for InDesign via Adobe's own plugin installer (UPIA),
# so Creative Cloud knows the plugin and doesn't drop it from the list again.
# Restart InDesign afterwards: Plugins > Gridwork for InDesign.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"

rm -f "$HERE/dist/Gridwork-InDesign.ccx"
mkdir -p "$HERE/dist"
(cd "$HERE/grids-id" && zip -qr "$HERE/dist/Gridwork-InDesign.ccx" . -x '.*')

# only remove if already installed (otherwise the installer hangs)
if "$UPIA" --list all 2>/dev/null | grep -q "Gridwork for InDesign"; then
  "$UPIA" --remove "Gridwork for InDesign" >/dev/null 2>&1 || true
fi
"$UPIA" --install "$HERE/dist/Gridwork-InDesign.ccx"
echo "Done. Restart InDesign > Plugins > Gridwork for InDesign"
