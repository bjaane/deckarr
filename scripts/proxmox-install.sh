#!/usr/bin/env bash
# Creates a small Debian LXC container on Proxmox VE with Deckarr in it.
# Run on the Proxmox host as root:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/bjaane/deckarr/main/scripts/proxmox-install.sh)"
#
# The defaults work for most hosts. Change them with environment variables in front of the
# command, for example:  CTID=150 STORAGE=local-zfs IP=192.168.1.50/24 GATEWAY=192.168.1.1 bash -c "…"
#
#   CTID       container ID                    (next free ID)
#   CT_NAME    container hostname              (deckarr)
#   CORES      CPU cores                       (1)
#   MEMORY     memory in MB                    (512)
#   DISK       disk size in GB                 (4)
#   STORAGE    storage for the container disk  (the one with the most free space)
#   BRIDGE     network bridge                  (vmbr0)
#   IP         dhcp, or an address like 192.168.1.50/24   (dhcp)
#   GATEWAY    gateway when IP is static
#   YES=1      don't ask before creating the container

set -euo pipefail

REPO="${DECKARR_REPO:-bjaane/deckarr}"
REF="${DECKARR_REF:-main}"
CTID="${CTID:-}"
CT_NAME="${CT_NAME:-deckarr}"
CORES="${CORES:-1}"
MEMORY="${MEMORY:-512}"
DISK="${DISK:-4}"
STORAGE="${STORAGE:-}"
BRIDGE="${BRIDGE:-vmbr0}"
IP="${IP:-dhcp}"
GATEWAY="${GATEWAY:-}"
YES="${YES:-}"

say() { printf '\e[1;33m›\e[0m %s\n' "$*"; }
ok() { printf '\e[1;32m✓\e[0m %s\n' "$*"; }
die() {
  printf '\e[1;31m✗ %s\e[0m\n' "$*" >&2
  exit 1
}

# ---------- checks ----------

[[ $EUID -eq 0 ]] || die "Run this as root on the Proxmox VE host."
for cmd in pct pveam pvesh pvesm; do
  command -v "$cmd" >/dev/null || die "This isn't a Proxmox VE host ($cmd is missing). Run it in the Proxmox shell."
done
[[ "$IP" == "dhcp" || "$IP" == */* ]] || die "IP must be dhcp or an address with a prefix, like 192.168.1.50/24."
ip link show "$BRIDGE" >/dev/null 2>&1 || die "The network bridge $BRIDGE doesn't exist. Set BRIDGE=… to one that does."

if [[ -z "$CTID" ]]; then
  CTID="$(pvesh get /cluster/nextid)"
fi
[[ "$CTID" =~ ^[0-9]+$ ]] || die "CTID must be a number."
if pct config "$CTID" >/dev/null 2>&1; then
  die "Container $CTID already exists. Pick another ID with CTID=…"
fi

# The storage with the most free space that can hold container disks.
if [[ -z "$STORAGE" ]]; then
  STORAGE="$(pvesm status -content rootdir 2>/dev/null | awk 'NR > 1 && $3 == "active" {print $6, $1}' | sort -rn | awk 'NR == 1 {print $2}')"
fi
[[ -n "$STORAGE" ]] || die "Found no storage for container disks. Set STORAGE=… (see pvesm status)."

TEMPLATE_STORAGE="$(pvesm status -content vztmpl 2>/dev/null | awk 'NR > 1 && $3 == "active" && !found {print $1; found = 1}')"
[[ -n "$TEMPLATE_STORAGE" ]] || die "Found no storage for container templates. Enable the VZDump/Container template content type on a storage, usually local."

# ---------- template ----------

say "Looking for a Debian container template"
pveam update >/dev/null 2>&1 || true
TEMPLATE="$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep -E '^debian-13-standard_' | sort -V | tail -n 1 || true)"
[[ -n "$TEMPLATE" ]] || TEMPLATE="$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep -E '^debian-12-standard_' | sort -V | tail -n 1 || true)"
[[ -n "$TEMPLATE" ]] || die "Couldn't find a Debian 12 or 13 template. Check the host's internet access."

# ---------- confirm ----------

NET0="name=eth0,bridge=${BRIDGE},ip=${IP}"
[[ "$IP" != "dhcp" && -n "$GATEWAY" ]] && NET0="${NET0},gw=${GATEWAY}"

cat <<EOF

  Deckarr will be installed in a new LXC container:

    ID         ${CTID}
    Hostname   ${CT_NAME}
    Template   ${TEMPLATE}
    CPU        ${CORES} core(s)
    Memory     ${MEMORY} MB
    Disk       ${DISK} GB on ${STORAGE}
    Network    ${BRIDGE}, ${IP}${GATEWAY:+, gateway ${GATEWAY}}

EOF
if [[ -z "$YES" && -t 0 ]]; then
  read -r -p "Create it? [Y/n] " answer
  [[ -z "$answer" || "$answer" =~ ^[Yy] ]] || die "Cancelled."
fi

# ---------- create ----------

if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -F "$TEMPLATE" >/dev/null; then
  say "Downloading $TEMPLATE"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE" >/dev/null
fi

say "Creating container $CTID"
# From here on a failure leaves a half-finished container; say how to remove it.
cleanup_hint() {
  local status=${1:-$?}
  [[ $status -eq 0 ]] || printf '\n\e[1;31m✗ Setup stopped.\e[0m Remove the unfinished container with: pct stop %s; pct destroy %s --purge\n' "$CTID" "$CTID" >&2
}
trap 'cleanup_hint $?' EXIT
pct create "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
  --hostname "$CT_NAME" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --swap 256 \
  --rootfs "${STORAGE}:${DISK}" \
  --net0 "$NET0" \
  --ostype debian \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1 \
  --tags deckarr \
  --description "Deckarr: https://github.com/${REPO}" >/dev/null
pct start "$CTID"

say "Waiting for the network"
for _ in $(seq 1 30); do
  if pct exec "$CTID" -- getent hosts github.com >/dev/null 2>&1; then break; fi
  sleep 2
done
pct exec "$CTID" -- getent hosts github.com >/dev/null 2>&1 || die "Container $CTID has no internet access. Check the bridge and IP settings."

# ---------- install ----------

setup="$(mktemp)"
trap 'status=$?; rm -f "$setup"; cleanup_hint "$status"' EXIT
curl -fsSL "https://raw.githubusercontent.com/${REPO}/${REF}/scripts/lxc-setup.sh" -o "$setup" || die "Couldn't download the setup script."
pct push "$CTID" "$setup" /root/deckarr-setup.sh --perms 755
pct exec "$CTID" -- bash /root/deckarr-setup.sh
pct exec "$CTID" -- rm -f /root/deckarr-setup.sh

ADDRESS="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"

cat <<EOF

$(ok "Deckarr is running in container ${CTID}")

  Open it on your phone:   http://${ADDRESS:-<container-ip>}:8484
  Update it later:         pct exec ${CTID} -- deckarr-update

  To control this Proxmox server from Deckarr, add Proxmox VE under
  Settings > Add a service, with an API token (see the README).

EOF
