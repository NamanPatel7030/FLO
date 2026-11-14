# Local Linux runner for the real-app desktop E2E suite (same packages as the ubuntu-24.04 CI job).
#   docker build -t flo-desktop-e2e tests/desktop-e2e/docker
#   tests/desktop-e2e/docker/run.sh
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl ca-certificates file pkg-config cmake clang libclang-dev rsync procps xz-utils \
      libwebkit2gtk-4.1-dev webkit2gtk-driver libayatana-appindicator3-dev librsvg2-dev libgtk-3-dev \
      libxdo-dev libasound2-dev libssl-dev libdbus-1-dev libxtst-dev libx11-dev libxi-dev \
      libpipewire-0.3-dev libspa-0.2-dev libgbm-dev libegl1-mesa-dev libxcb1-dev libxrandr-dev \
      xvfb xauth x11-utils x11-xserver-utils xdotool openbox xcompmgr dbus dbus-x11 imagemagick \
      python3 python3-tk at-spi2-core fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
# Node 22
RUN curl -fsSL https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/').tar.xz \
    | tar -xJ -C /usr/local --strip-components=1
# Rust (the official image's toolchain; static.rust-lang.org can be very slow from some networks)
# + tauri-driver
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
COPY --from=rust:1-slim-bookworm /usr/local/rustup /usr/local/rustup
COPY --from=rust:1-slim-bookworm /usr/local/cargo /usr/local/cargo
# tauri-driver is installed by inside.sh into the build volume (crate downloads seeded from the host)
# deep links (xdg-open → flo:// handler) and a clean desktop-like session
RUN apt-get update && apt-get install -y --no-install-recommends xdg-utils desktop-file-utils wmctrl \
 && rm -rf /var/lib/apt/lists/*
