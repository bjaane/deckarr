#!/bin/sh
# Runs as root only long enough to make /config writable, then drops to PUID:PGID
# (Unraid's nobody:users = 99:100 by default). If the container is started with
# --user, it is already unprivileged and starts directly.
set -e

CONFIG_DIR="${CONFIG_DIR:-/config}"

if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-99}"
  PGID="${PGID:-100}"
  mkdir -p "$CONFIG_DIR"
  chown -R "$PUID:$PGID" "$CONFIG_DIR"
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
