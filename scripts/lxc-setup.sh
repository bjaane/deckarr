#!/usr/bin/env bash
# Installs or updates Deckarr inside a Debian (LXC) container, without Docker.
# proxmox-install.sh runs this once; afterwards it stays as /usr/local/bin/deckarr-update.
#
#   deckarr-update            install the latest release, or update to it
#   deckarr-update --force    reinstall the latest release even when it's current
#
# The app goes to /opt/deckarr, settings stay in /var/lib/deckarr, and it runs as the
# "deckarr" user under systemd on port 8484.

set -euo pipefail

REPO="${DECKARR_REPO:-bjaane/deckarr}"
APP_DIR="${DECKARR_APP_DIR:-/opt/deckarr}"
DATA_DIR="${DECKARR_DATA_DIR:-/var/lib/deckarr}"
PORT="${DECKARR_PORT:-8484}"
UNIT_FILE="${DECKARR_UNIT_FILE:-/etc/systemd/system/deckarr.service}"
SELF_BIN="${DECKARR_SELF_BIN:-/usr/local/bin/deckarr-update}"
FORCE=""
[[ "${1:-}" == "--force" ]] && FORCE=1

say() { printf '\e[1;33m›\e[0m %s\n' "$*"; }
ok() { printf '\e[1;32m✓\e[0m %s\n' "$*"; }
die() {
  printf '\e[1;31m✗ %s\e[0m\n' "$*" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || die "Run this as root."
export DEBIAN_FRONTEND=noninteractive

# ---------- packages ----------

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if ! command -v curl >/dev/null || ! command -v tar >/dev/null; then
  say "Installing curl"
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates tar >/dev/null
fi

if [[ "$(node_major)" -lt 20 ]]; then
  say "Installing Node.js"
  apt-get update -qq
  # Debian 13 ships Node.js 20; older releases get Node.js 22 from NodeSource.
  candidate="$(apt-cache policy nodejs 2>/dev/null | awk '/Candidate:/ {print $2}')"
  if [[ "${candidate%%.*}" =~ ^[0-9]+$ ]] && [[ "${candidate%%.*}" -ge 20 ]]; then
    apt-get install -y -qq nodejs >/dev/null
  else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi
  [[ "$(node_major)" -ge 20 ]] || die "Couldn't install Node.js 20 or newer."
  ok "Node.js $(node -v)"
fi

# ---------- release ----------

say "Looking up the latest Deckarr release"
tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
[[ -n "$tag" ]] || die "Couldn't find a Deckarr release on GitHub. Check the container's internet access."
latest="${tag#v}"
installed=""
[[ -f "$APP_DIR/package.json" ]] && installed="$(node -p "require('$APP_DIR/package.json').version" 2>/dev/null || true)"

if [[ "$installed" == "$latest" && -z "$FORCE" ]]; then
  ok "Deckarr $installed is already the latest version."
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
say "Downloading Deckarr $latest"
curl -fsSL "https://github.com/${REPO}/archive/refs/tags/${tag}.tar.gz" -o "$work/deckarr.tar.gz"
mkdir "$work/src"
tar -xzf "$work/deckarr.tar.gz" -C "$work/src" --strip-components=1
[[ -f "$work/src/server/index.js" ]] || die "The download doesn't look like Deckarr."

# Keep this updater current with the release it installs.
if [[ -f "$work/src/scripts/lxc-setup.sh" ]]; then
  install -m 755 "$work/src/scripts/lxc-setup.sh" "$work/deckarr-update"
fi

mkdir "$work/app"
cp -r "$work/src/server" "$work/src/public" "$work/src/package.json" "$work/app/"
[[ -f "$work/src/LICENSE" ]] && cp "$work/src/LICENSE" "$work/app/"

# ---------- user, data and service ----------

if ! id deckarr >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin deckarr
fi
mkdir -p "$DATA_DIR"
chown deckarr:deckarr "$DATA_DIR"
chmod 700 "$DATA_DIR"

cat >"$UNIT_FILE" <<EOF
[Unit]
Description=Deckarr
After=network-online.target
Wants=network-online.target

[Service]
User=deckarr
Group=deckarr
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=CONFIG_DIR=${DATA_DIR}
ExecStart=$(command -v node) ${APP_DIR}/server/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

say "Installing Deckarr $latest"
systemctl daemon-reload
systemctl stop deckarr 2>/dev/null || true
rm -rf "${APP_DIR}.old"
[[ -d "$APP_DIR" ]] && mv "$APP_DIR" "${APP_DIR}.old"
mkdir -p "$(dirname "$APP_DIR")"
mv "$work/app" "$APP_DIR"
chown -R root:root "$APP_DIR"
systemctl enable -q deckarr
systemctl start deckarr
rm -rf "${APP_DIR}.old"

if [[ -f "$work/deckarr-update" ]]; then
  install -m 755 "$work/deckarr-update" "$SELF_BIN"
elif [[ "$(readlink -f "$0")" != "$(readlink -f "$SELF_BIN" 2>/dev/null || true)" ]]; then
  install -m 755 "$0" "$SELF_BIN"
fi

if [[ "$installed" == "$latest" ]]; then
  ok "Reinstalled Deckarr $latest"
elif [[ -n "$installed" ]]; then
  ok "Updated Deckarr from $installed to $latest"
else
  ok "Installed Deckarr $latest"
fi
