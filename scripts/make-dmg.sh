#!/usr/bin/env bash
# Package Flo.app into a styled installer DMG (background, arrow, icon layout).
# usage: bash scripts/make-dmg.sh [path/to/Flo.app] [out.dmg]
# Needs dmgbuild (pure Python): pip install dmgbuild. Background source: scripts/dmg/background.html
set -euo pipefail
cd "$(dirname "$0")/.."
APP="${1:-src-tauri/target/release/bundle/macos/Flo.app}"
VER=$(python3 -c 'import json;print(json.load(open("src-tauri/tauri.conf.json"))["version"])')
OUT="${2:-src-tauri/target/release/bundle/dmg/Flo-$VER-mac-$(uname -m).dmg}"
mkdir -p "$(dirname "$OUT")"
DMGBUILD="${DMGBUILD:-dmgbuild}"
"$DMGBUILD" -s scripts/dmg/settings.py -D app="$APP" "Flo" "$OUT"
echo "Built $OUT"
