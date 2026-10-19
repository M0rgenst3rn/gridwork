#!/bin/bash
# Installs Gridwork for Illustrator (a CEP panel) for the current user.
# Restart Illustrator afterwards: Window > Extensions > Gridwork.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.linus.gridwork.illustrator"

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -R "$HERE/grids-ai" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# The panel is not signed by Adobe, so Illustrator has to be allowed to load unsigned panels
# (one setting per CEP version; Illustrator 2020-2026 use 9 to 12).
for v in 9 10 11 12 13; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done

echo "Done. Restart Illustrator > Window > Extensions > Gridwork"
