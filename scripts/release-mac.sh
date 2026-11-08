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
#   4. publishes it: website/public/releases/<v>/ + website/releases/latest.json (served by
#      website/app/api/updates/...). Deploy the website and every user gets the update.
#
# Hosting the file elsewhere (GitHub Releases, S3, ...): set RELEASE_BASE_URL to the folder URL,
# upload the .tar.gz there, and latest.json points at it instead.
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
NAME="Flo_${VERSION}_${ARCH}.app.tar.gz"
OUT="website/public/releases/$VERSION"
mkdir -p "$OUT"
# the updater expects the archive to contain Flo.app at its root
COPYFILE_DISABLE=1 tar -czf "$OUT/$NAME" -C "$(dirname "$APP")" Flo.app
npx tauri signer sign -f "$KEY" -p "" "$OUT/$NAME" >/dev/null
[ -f "$OUT/$NAME.sig" ] || { echo "Signing the update failed"; exit 1; }

python3 scripts/write-release-manifest.py "$VERSION" "darwin-$ARCH" "$NAME" "$OUT/$NAME.sig" "$NOTES"
echo
echo "Published Flo $VERSION for darwin-$ARCH"
echo "  file:     $OUT/$NAME ($(du -h "$OUT/$NAME" | cut -f1))"
echo "  manifest: website/releases/latest.json"
[ -n "${RELEASE_BASE_URL:-}" ] && echo "  upload $OUT/$NAME to $RELEASE_BASE_URL/ before users update"
echo "Deploy the website; installed copies offer the update within a few hours (or on Check for updates)."
