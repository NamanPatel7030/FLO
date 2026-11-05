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
  # codesign only searches keychains on the user search list → add ours just for signing,
  # then restore the original list (even on failure).
  ORIG=()
  while IFS= read -r l; do l="${l//\"/}"; l="${l#"${l%%[![:space:]]*}"}"; [ -n "$l" ] && ORIG+=("$l"); done < <(security list-keychains -d user)
  trap 'security list-keychains -d user -s "${ORIG[@]}"' EXIT
  security list-keychains -d user -s "${ORIG[@]}" "$KC"
  security unlock-keychain -p "$(cat "$HOME/.flo-signing/keychain-password")" "$KC"
  codesign --force --deep --keychain "$KC" --sign "Flo Local Signing" --identifier com.flo.flow "$APP"
  security list-keychains -d user -s "${ORIG[@]}"
  trap - EXIT
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
