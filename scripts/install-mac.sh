#!/bin/bash
# Build Flo, sign the bundle with a stable identifier, install to /Applications and launch.
#   bash scripts/install-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

CARGO_INCREMENTAL=0 npm run tauri build -- --bundles app
APP="src-tauri/target/release/bundle/macos/Flo.app"

# Seal the whole bundle (not just the linker signature) with identifier com.flo.flow.
codesign --force --deep --sign - --identifier com.flo.flow "$APP"

pkill -x flo-flow 2>/dev/null || true
sleep 1
rm -rf "/Applications/Flo Flow.app" "/Applications/Flo.app"
ditto "$APP" "/Applications/Flo.app"
xattr -dr com.apple.quarantine "/Applications/Flo.app" 2>/dev/null || true
open "/Applications/Flo.app"
echo "Installed /Applications/Flo.app"
