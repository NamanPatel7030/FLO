#!/bin/bash
# Build Flo, sign it, install to /Applications and launch.
#   bash scripts/setup-signing.sh   # once — stable identity so permissions survive updates
#   bash scripts/install-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

CARGO_INCREMENTAL=0 npm run tauri build -- --bundles app
APP="src-tauri/target/release/bundle/macos/Flo.app"

bash scripts/sign-mac.sh "$APP"

pkill -x flo-flow 2>/dev/null || true
sleep 1
rm -rf "/Applications/Flo Flow.app"
# update the installed bundle in place (keeps the same bundle on disk for macOS privacy records)
mkdir -p "/Applications/Flo.app"
rsync -a --delete "$APP/" "/Applications/Flo.app/"
xattr -dr com.apple.quarantine "/Applications/Flo.app" 2>/dev/null || true
open "/Applications/Flo.app"
echo "Installed /Applications/Flo.app"
