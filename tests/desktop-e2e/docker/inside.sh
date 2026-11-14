#!/usr/bin/env bash
# Runs inside the flo-desktop-e2e container (see run.sh): build Flo's e2e binary from a copy of the
# checkout, then run the real-app suite on a virtual X display with a window manager + compositor.
set -euo pipefail
SRC=/work/src
export CARGO_TARGET_DIR=/work/target
export CARGO_HOME=/work/cargo
mkdir -p "$SRC" "$CARGO_HOME/registry"
if [ -d /seed-registry/cache ]; then
  cp -rn /seed-registry/cache /seed-registry/index "$CARGO_HOME/registry/" 2>/dev/null || true
fi
export PATH=$CARGO_HOME/bin:$PATH
command -v tauri-driver >/dev/null || cargo install tauri-driver --locked
rsync -a --delete --exclude node_modules --exclude target --exclude .git --exclude dist \
  --exclude 'tests/desktop-e2e/artifacts' --exclude 'tests/desktop-e2e/.cache' --exclude mobile --exclude website \
  --exclude playwright-report --exclude test-results /host/ "$SRC/"

cd "$SRC"
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  npm ci --no-audit --no-fund --loglevel=error
  # arm64 hosts (Apple Silicon): GCC 13 rejects the -mcpu=native+nodotprod… flags whisper.cpp's
  # ggml picks there; clang takes them (x86_64, the shipped Linux target, is unaffected)
  if [ "$(uname -m)" = "aarch64" ]; then export CMAKE_C_COMPILER=clang CMAKE_CXX_COMPILER=clang++; fi
  # the .deb a user installs, built from the e2e profile (+ the test-mode feature, inert unless
  # FLO_E2E=1); vite only here (tsc runs with the other suites)
  CARGO_BUILD_JOBS="${JOBS:-6}" npx tauri build --features e2e --bundles deb \
    --config '{"build":{"beforeBuildCommand":"npx vite build --logLevel warn"}}' -- --profile e2e
fi
# install it like a user would: dependencies, desktop entry, metainfo, flo:// handler
DEB=$(ls -t "$CARGO_TARGET_DIR"/e2e/bundle/deb/*.deb | head -1)
apt-get install -y -qq "$DEB" >/dev/null
dpkg -s flo | grep -E '^(Package|Version|Depends|Section)' || true

cd tests/desktop-e2e
mkdir -p /work/cache && ln -sfn /work/cache .cache
npm ci --no-audit --no-fund --loglevel=error
npm run fetch-model

export FLO_APP=/usr/bin/flo-flow
export FLO_E2E_ARTIFACTS=/artifacts
export XDG_RUNTIME_DIR=/tmp/xdg-runtime && mkdir -p -m 700 "$XDG_RUNTIME_DIR"
export DISPLAY=:99 XDG_SESSION_TYPE=x11 XDG_CURRENT_DESKTOP=openbox NO_AT_BRIDGE=1
rm -rf /artifacts/* 2>/dev/null || true

Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &
for _ in $(seq 50); do xdpyinfo -display :99 >/dev/null 2>&1 && break; sleep 0.1; done
dbus-run-session -- bash -c '
  openbox >/dev/null 2>&1 &
  xcompmgr >/dev/null 2>&1 &
  sleep 1
  npx wdio run wdio.conf.mjs '"${SPEC:+--spec $SPEC}"'
'
