#!/bin/bash
# Build Flo, sign it, install to /Applications and launch.
#   bash scripts/setup-signing.sh   # once — stable identity so permissions survive updates
#   bash scripts/install-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

CARGO_INCREMENTAL=0 npm run tauri build -- --bundles app
APP="src-tauri/target/release/bundle/macos/Flo.app"

KC="$HOME/.flo-signing/flo-signing.keychain-db"
if [ -f "$KC" ]; then
  security unlock-keychain -p "$(cat "$HOME/.flo-signing/keychain-password")" "$KC"
  HASH="$(security find-certificate -c "Flo Local Signing" -Z "$KC" | awk '/SHA-1/{print $3}')"
  codesign --force --deep --keychain "$KC" --sign "$HASH" --identifier com.flo.flow "$APP"
  echo "Signed with stable identity (permissions persist across updates)"
else
  codesign --force --deep --sign - --identifier com.flo.flow "$APP"
  echo "Ad-hoc signed — run scripts/setup-signing.sh once so permissions survive updates"
fi
codesign --verify --deep "$APP"

pkill -x flo-flow 2>/dev/null || true
sleep 1
rm -rf "/Applications/Flo Flow.app" "/Applications/Flo.app"
ditto "$APP" "/Applications/Flo.app"
xattr -dr com.apple.quarantine "/Applications/Flo.app" 2>/dev/null || true
open "/Applications/Flo.app"
echo "Installed /Applications/Flo.app"
