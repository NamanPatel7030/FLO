#!/usr/bin/env bash
# Run the desktop E2E suite locally on Linux (Ubuntu 24.04 in Docker, any host incl. macOS).
#   tests/desktop-e2e/docker/run.sh                 build + run every spec
#   SPEC=specs/05-pill.e2e.mjs tests/desktop-e2e/docker/run.sh
#   SKIP_BUILD=1 ...                                reuse the last build
#   CLEAN=1 tests/desktop-e2e/docker/run.sh         remove the image + build volume afterwards
# Screenshots, logs and flo.log per spec land in tests/desktop-e2e/artifacts/.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
IMAGE=flo-desktop-e2e
VOLUME=flo-desktop-e2e-work

if [ "${REBUILD:-0}" = "1" ] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build -t "$IMAGE" "$HERE"
fi
mkdir -p "$ROOT/tests/desktop-e2e/artifacts"
# seed the crate downloads from the host's cargo cache when there is one (read-only)
SEED=()
[ -d "$HOME/.cargo/registry/cache" ] && SEED=(-v "$HOME/.cargo/registry":/seed-registry:ro)
set +e
docker run --rm --init --name flo-desktop-e2e --shm-size=1g "${SEED[@]}" \
  -e SPEC="${SPEC:-}" -e SKIP_BUILD="${SKIP_BUILD:-0}" -e JOBS="${JOBS:-6}" -e FLO_E2E_RETRIES="${FLO_E2E_RETRIES:-1}" \
  -v "$ROOT":/host:ro -v "$VOLUME":/work -v "$ROOT/tests/desktop-e2e/artifacts":/artifacts \
  "$IMAGE" bash /host/tests/desktop-e2e/docker/inside.sh
code=$?
set -e
if [ "${CLEAN:-0}" = "1" ]; then
  docker volume rm "$VOLUME" >/dev/null || true
  docker image rm "$IMAGE" >/dev/null || true
fi
exit $code
