#!/bin/bash
# Publish a Flo update. Every installed Flo sees "Flo <version> is available → Update", downloads it,
# verifies our signature, installs, and asks to restart.
#
#   bash scripts/release-mac.sh 0.2.0 "What's new, in a sentence or two"
#
# What it does:
#   1. sets the version in tauri.conf.json, Cargo.toml and package.json
#   2. builds Flo.app and signs it with the stable local identity (permissions survive the update)
#   3. packs Flo_<v>_<arch>.app.tar.gz and signs it with the update key (~/.flo-signing/updater.key)
#   4. builds the installer DMG (scripts/make-dmg.sh) under a stable name, Flo-mac-<arch>.dmg
#   5. publishes GitHub Release v<version> on NamanPatel7030/FLO with the bundle, latest.json and
#      the DMG. The website's update server reads latest.json from the newest release and the
#      Download button points at releases/latest/download/Flo-mac-arm64.dmg, so nothing else
#      needs deploying. The release notes double as the public changelog (/changelog).
#
# NO_PUBLISH=1 builds everything locally without creating the GitHub release.
# RELEASE_BASE_URL overrides where latest.json says the bundle lives.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

VERSION="${1:?usage: release-mac.sh <version> [notes]}"
NOTES="${2:-}"
KEY="$HOME/.flo-signing/updater.key"
[ -f "$KEY" ] || { echo "Missing update key $KEY (npx tauri signer generate -w $KEY)"; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "Version must look like 1.2.3"; exit 1; }

python3 scripts/set-version.py "$VERSION"

CARGO_INCREMENTAL=0 npm run tauri build -- --bundles app
APP="src-tauri/target/release/bundle/macos/Flo.app"
bash scripts/sign-mac.sh "$APP"

case "$(uname -m)" in arm64) ARCH=aarch64 ;; *) ARCH=x86_64 ;; esac
REPO="${RELEASE_REPO:-NamanPatel7030/FLO}"
export RELEASE_BASE_URL="${RELEASE_BASE_URL:-https://github.com/$REPO/releases/download/v$VERSION}"
NAME="Flo_${VERSION}_${ARCH}.app.tar.gz"
OUT="website/public/releases/$VERSION"
mkdir -p "$OUT"
# the updater expects the archive to contain Flo.app at its root
COPYFILE_DISABLE=1 tar -czf "$OUT/$NAME" -C "$(dirname "$APP")" Flo.app
npx tauri signer sign -f "$KEY" -p "" "$OUT/$NAME" >/dev/null
[ -f "$OUT/$NAME.sig" ] || { echo "Signing the update failed"; exit 1; }

python3 scripts/write-release-manifest.py "$VERSION" "darwin-$ARCH" "$NAME" "$OUT/$NAME.sig" "$NOTES"

DMG_ARCH=$([ "$ARCH" = aarch64 ] && echo arm64 || echo x86_64)
DMG="$OUT/Flo-mac-$DMG_ARCH.dmg"
if command -v "${DMGBUILD:-dmgbuild}" >/dev/null 2>&1; then
  bash scripts/make-dmg.sh "$APP" "$DMG"
else
  echo "dmgbuild not found (pip install dmgbuild); skipping the installer DMG"
  DMG=""
fi

echo
echo "Built Flo $VERSION for darwin-$ARCH"
echo "  update:   $OUT/$NAME ($(du -h "$OUT/$NAME" | cut -f1))"
echo "  manifest: website/releases/latest.json"
[ -n "$DMG" ] && echo "  install:  $DMG"

if [ "${NO_PUBLISH:-}" = "1" ]; then
  echo "NO_PUBLISH=1: not creating the GitHub release."
  exit 0
fi
cp website/releases/latest.json "$OUT/latest.json"
ASSETS=("$OUT/$NAME" "$OUT/$NAME.sig" "$OUT/latest.json")
[ -n "$DMG" ] && ASSETS+=("$DMG")
# The site's download buttons follow whichever release is newest, so carry the other platforms'
# installers forward. The desktop workflow replaces Windows/Linux with fresh builds for this tag;
# the Android APK stays until a new one is uploaded.
CARRY="$OUT/carry"
rm -rf "$CARRY" && mkdir -p "$CARRY"
for f in Flo-android.apk android-latest.json Flo-windows-x64-setup.exe Flo-windows-x64.msi Flo-linux-x86_64.AppImage Flo-linux-amd64.deb; do
  if gh release download -R "$REPO" -p "$f" -D "$CARRY" >/dev/null 2>&1; then ASSETS+=("$CARRY/$f"); else echo "  (no $f on the current release to carry forward)"; fi
done
git push -q "$(git remote | head -1)" HEAD 2>/dev/null || true  # the tagged commit must exist on GitHub
gh release create "v$VERSION" -R "$REPO" --target "$(git rev-parse HEAD)" \
  --title "Flo $VERSION" --notes "${NOTES:-Flo $VERSION}" --latest "${ASSETS[@]}"
# the local manifest would shadow the published one on a dev server; keep it out of the way
rm -f website/releases/latest.json
echo
echo "Published https://github.com/$REPO/releases/tag/v$VERSION"
echo "Installed copies offer the update at their next check (within a few hours, or Check for updates)."
