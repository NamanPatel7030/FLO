#!/bin/bash
# Sign a built Flo.app with the stable local identity (scripts/setup-signing.sh creates it once).
# A stable identity keeps the app's designated requirement the same across versions, so macOS keeps
# Accessibility / Microphone / Input Monitoring permissions after every update.
#   bash scripts/sign-mac.sh path/to/Flo.app
set -euo pipefail
APP="$1"
KC="$HOME/.flo-signing/flo-signing.keychain-db"
if [ -n "${APPLE_SIGN_IDENTITY:-}" ]; then
  # Apple Developer ID (e.g. "Developer ID Application: Naman Patel (TEAMID)"): hardened runtime +
  # secure timestamp, ready for notarization, so macOS opens Flo with no warning.
  codesign --force --deep --options runtime --timestamp \
    --entitlements "$(dirname "$0")/flo.entitlements" --sign "$APPLE_SIGN_IDENTITY" "$APP"
  echo "Signed with Developer ID"
elif [ -f "$KC" ]; then
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
# macOS keys every privacy grant (Accessibility, Microphone) to this requirement. With the stable
# identity it reads `identifier "com.flo.flow" and certificate leaf = H"..."`, the same for every
# version, so grants survive updates. An ad-hoc signature pins a cdhash that changes every build.
DR="$(codesign -d -r- "$APP" 2>&1 | sed -n 's/^designated => //p')"
echo "Designated requirement: $DR"
case "$DR" in
  *cdhash*) echo "WARNING: requirement pins this build's cdhash; Accessibility will reset after the next update" ;;
esac
