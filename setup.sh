#!/usr/bin/env bash
# =====================================================================
#  DASH Parkour server: one-command setup for a Raspberry Pi
#
#  On the Pi, run:
#    curl -fsSL https://raw.githubusercontent.com/ActuallyDigitsofpi314159/Dash-Parkour/main/dash-server/setup.sh | bash
#
#  You're asked for things only at the start (your password if the Pi wants it,
#  then one Cloudflare login in a browser on any device). After that you can
#  walk away: everything else happens by itself. Run it again any time: it
#  picks up where it left off and fixes what's missing. See README.md.
#
#  This file has no passwords or keys in it, so it's safe on GitHub.
# =====================================================================
set -u
REPO_URL="${REPO_URL:-https://github.com/ActuallyDigitsofpi314159/Dash-Parkour.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP=/opt/dash-party           # program files
DATA=/var/lib/dash-party      # admin keys, bans, status, logs (private)
ETC=/etc/dash-party           # tunnel settings and its secret credentials (private)
SVC_USER=dashparty            # the server runs as this locked-down user, not as you
LOG="$HOME/dash-setup.log"
ME="$(id -un)"
TTY=/dev/tty

# ---------------- looks ----------------
if [ -t 1 ] || [ -e "$TTY" ]; then
  B=$'\e[1m'; D=$'\e[2m'; R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; C=$'\e[36m'; N=$'\e[0m'
else B=; D=; R=; G=; Y=; C=; N=; fi
STEP_N=0; STEPS_TOTAL=12; FAILED=()
say()  { printf '%s\n' "$*" | tee -a "$LOG" >/dev/null; printf '%s\n' "$*"; }
step() { STEP_N=$((STEP_N + 1)); printf '\n%s[%2d/%d]%s %s%s%s\n' "$C" "$STEP_N" "$STEPS_TOTAL" "$N" "$B" "$1" "$N"; echo "== [$STEP_N] $1 ($(date))" >>"$LOG"; }
ok()   { printf '       %s✓%s %s\n' "$G" "$N" "$1"; echo "   ok: $1" >>"$LOG"; }
warn() { printf '       %s!%s %s\n' "$Y" "$N" "$1"; echo "   warn: $1" >>"$LOG"; }
bad()  { printf '       %s✗ %s%s\n' "$R" "$1" "$N"; echo "   FAILED: $1" >>"$LOG"; FAILED+=("$1"); }
ask()  { # ask "question" default -> REPLY
  local q="$1" def="$2" a=""
  if [ -r "$TTY" ]; then printf '  %s %s[%s]%s ' "$q" "$D" "$def" "$N" >"$TTY"; read -r a <"$TTY" || a=""; fi
  REPLY="${a:-$def}"
}
# run a command, retrying (the Pi's internet can be slow or drop out)
try() { # try TRIES "what" cmd...
  local n="$1" what="$2"; shift 2
  local i=1
  while :; do
    if "$@" >>"$LOG" 2>&1; then return 0; fi
    if [ "$i" -ge "$n" ]; then return 1; fi
    printf '       %s…%s %s didn'"'"'t work, trying again (%d/%d)\n' "$D" "$N" "$what" "$i" "$n"
    sleep $((i * 10)); i=$((i + 1))
  done
}

clear 2>/dev/null || true
cat <<EOF
${B}${R}  ____    _    ____  _   _
 |  _ \\  / \\  / ___|| | | |   ${N}${B}PARKOUR server setup${N}${B}${R}
 | | | |/ _ \\ \\___ \\| |_| |
 | |_| / ___ \\ ___) |  _  |   ${N}multiplayer parties + your website,${B}${R}
 |____/_/   \\_\\____/|_| |_|   ${N}${B}on this Raspberry Pi${N}

 A log of everything goes to ${C}$LOG${N}
EOF
echo "===== setup started $(date) as $ME =====" >>"$LOG"

# ---------------- 1. questions and password (the only typing) ----------------
step "A few questions (the only part where you need to be here)"
if [ "$(id -u)" = 0 ]; then
  warn "You're running this as root. That works, but running it as your normal user (with sudo) is better."
fi
if ! sudo -v </dev/tty 2>/dev/null; then
  if ! sudo -v; then bad "This needs sudo (administrator) rights on the Pi."; exit 1; fi
fi
# keep sudo alive while we work (so it never asks again)
( while true; do sudo -n true 2>/dev/null; sleep 50; kill -0 "$$" 2>/dev/null || exit; done ) &
SUDO_KEEPER=$!
trap 'kill $SUDO_KEEPER 2>/dev/null' EXIT

CONF_OLD="$ETC/setup.conf"
DOMAIN=""; PARTY_SUB=""; HOST_SITE=""
if sudo test -r "$CONF_OLD"; then
  # shellcheck disable=SC1090
  eval "$(sudo cat "$CONF_OLD" | grep -E '^(DOMAIN|PARTY_SUB|HOST_SITE)=')"
  ok "Using your answers from last time ($DOMAIN). Delete $CONF_OLD to be asked again."
else
  ask "Your domain (it must already be added to Cloudflare, see README):" "digitsandkineto.com"; DOMAIN="$REPLY"
  ask "Address for the party server:" "party"; PARTY_SUB="$REPLY"
  ask "Also host your website ($DOMAIN, www.$DOMAIN) from this Pi? (y/n)" "y"; HOST_SITE="$REPLY"
fi
DOMAIN="$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed 's#^https\?://##; s#/.*##')"
PARTY_SUB="$(printf '%s' "$PARTY_SUB" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9-')"
case "$HOST_SITE" in y*|Y*) HOST_SITE=yes ;; *) HOST_SITE=no ;; esac
PARTY_HOST="$PARTY_SUB.$DOMAIN"
ok "Party server will be https://$PARTY_HOST"
[ "$HOST_SITE" = yes ] && ok "Website will be https://$DOMAIN (games from your GitHub repo)"

ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
case "$ARCH" in arm64|aarch64) CF_DEB=cloudflared-linux-arm64.deb ;; armhf|armv7l|armel) CF_DEB=cloudflared-linux-arm.deb ;; amd64|x86_64) CF_DEB=cloudflared-linux-amd64.deb ;; *) CF_DEB=cloudflared-linux-arm64.deb ;; esac

# ---------------- 2. Cloudflare login (once) ----------------
step "Cloudflare login (once, so the Pi can get its permanent address)"
if ! command -v cloudflared >/dev/null 2>&1; then
  if try 5 "Downloading cloudflared" curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/$CF_DEB" &&
     try 3 "Installing cloudflared" sudo dpkg -i /tmp/cloudflared.deb; then ok "cloudflared installed"; else bad "Couldn't install cloudflared (check the internet and run this again)"; exit 1; fi
else ok "cloudflared is already installed ($(cloudflared --version 2>/dev/null | head -1 | awk '{print $3}'))"; fi
CERT="$HOME/.cloudflared/cert.pem"
if [ -s "$CERT" ]; then
  ok "Already logged in to Cloudflare"
else
  cat <<EOF

       ${B}Open the link below on any device (your phone is fine), log in to
       Cloudflare and click ${C}$DOMAIN${N}${B}, then Authorize.${N}
       ${D}(It waits here until you're done. If $DOMAIN isn't in the list,
       add it to Cloudflare first: README.md, step 1.)${N}

EOF
  cloudflared tunnel login 2>&1 | tee -a "$LOG" | grep --line-buffered -E 'https://|cert.pem|rror' | sed 's/^/       /'
  if [ -s "$CERT" ]; then ok "Logged in"; else bad "The Cloudflare login didn't finish. Run this command again to retry."; exit 1; fi
fi

cat <<EOF

 ${G}${B}That's everything I need from you!${N}
 The rest runs by itself (about 10-30 minutes on a Pi 3). You can leave now.
 When you're back, type ${C}dash-party${N} to see how it's doing.
EOF

# ---------------- 3. system packages ----------------
step "Installing what the server needs (Node.js, git, security updates)"
export DEBIAN_FRONTEND=noninteractive
try 5 "Updating the package list" sudo -E apt-get update -y || warn "Package list update failed (continuing with what's there)"
if try 5 "Installing packages" sudo -E apt-get install -y --no-install-recommends nodejs git curl ca-certificates unattended-upgrades jq; then
  ok "Node.js $(node --version 2>/dev/null), git, curl"
else bad "Couldn't install packages"; fi
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 14 ]; then
  bad "Node.js is older than version 14 ($(node --version)). Update Raspberry Pi OS, then run this again."
fi

# ---------------- 4. user, folders, files ----------------
step "Getting the server files"
id "$SVC_USER" >/dev/null 2>&1 || sudo useradd --system --home-dir "$DATA" --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
sudo mkdir -p "$APP" "$DATA" "$ETC"
sudo chown "$SVC_USER:$SVC_USER" "$DATA"; sudo chmod 700 "$DATA"
sudo chown root:"$SVC_USER" "$ETC"; sudo chmod 750 "$ETC"
if [ -d "$APP/repo/.git" ]; then
  if try 3 "Updating from GitHub" sudo -u "$SVC_USER" git -C "$APP/repo" pull --ff-only; then ok "Updated from GitHub"; else warn "Couldn't update from GitHub (using the copy already on the Pi)"; fi
else
  sudo rm -rf "$APP/repo"; sudo mkdir -p "$APP/repo"; sudo chown "$SVC_USER:$SVC_USER" "$APP/repo"
  if try 5 "Downloading from GitHub" sudo -u "$SVC_USER" git clone --depth 1 -b "$REPO_BRANCH" "$REPO_URL" "$APP/repo"; then ok "Downloaded $REPO_URL"; else bad "Couldn't download the repo from GitHub"; fi
fi
SRC="$APP/repo/dash-server"
if [ -f "$SRC/server.js" ]; then
  sudo install -m 644 "$SRC/server.js" "$APP/server.js"
  sudo install -m 755 "$SRC/dash-party" /usr/local/bin/dash-party
  sudo install -m 755 "$SRC/dash-watchdog" "$APP/dash-watchdog"
  ok "Installed the server, the watchdog and the dash-party command"
else bad "The repo has no dash-server/server.js (upload the dash-server folder to GitHub first)"; fi

# ---------------- 5. admin keys (for /kick and /ban) ----------------
step "Admin keys for /kick and /ban"
KEYFILE="$HOME/dash-admin-keys.txt"
if sudo test -s "$DATA/admins.json"; then
  ok "Admin keys already made (see them with: dash-party keys)"
else
  K1="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | cut -c1-32)"
  K2="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | cut -c1-32)"
  H1="$(printf '%s' "$K1" | sha256sum | cut -d' ' -f1)"; H2="$(printf '%s' "$K2" | sha256sum | cut -d' ' -f1)"
  printf '[{"name":"digitsofpi","hash":"%s"},{"name":"kineto","hash":"%s"}]\n' "$H1" "$H2" | sudo tee "$DATA/admins.json" >/dev/null
  sudo chown "$SVC_USER:$SVC_USER" "$DATA/admins.json"; sudo chmod 600 "$DATA/admins.json"
  umask 077
  cat >"$KEYFILE" <<EOF
DASH Parkour admin keys (made $(date)).
KEEP THESE PRIVATE. Never put them on GitHub, Khan Academy, Discord or in the game files.
Anyone with a key can kick and ban players on your server.

Digitsofpi: $K1
Kineto:     $K2

How to use: in a server-mode game, type /kick NAME or /ban NAME in chat (while
signed in as your admin name). The first time, the game asks for your key.
To make new keys: sudo rm $DATA/admins.json and run the setup again.
EOF
  chmod 600 "$KEYFILE"; umask 022
  sudo install -m 600 -o root -g root "$KEYFILE" "$ETC/admin-keys.txt"
  ok "Made two keys (one for you, one for Kineto): see them with ${C}dash-party keys${N}"
fi

# ---------------- 6. the permanent tunnel ----------------
step "Making the permanent Cloudflare tunnel"
TUN=dash-party
TUN_ID="$(cloudflared tunnel list --name "$TUN" --output json 2>>"$LOG" | jq -r '.[0].id // empty' 2>/dev/null)"
if [ -n "$TUN_ID" ] && [ ! -s "$HOME/.cloudflared/$TUN_ID.json" ] && ! sudo test -s "$ETC/tunnel.json"; then
  warn "A tunnel called $TUN exists but its key isn't on this Pi: making a new one"
  cloudflared tunnel cleanup "$TUN" >>"$LOG" 2>&1; cloudflared tunnel delete -f "$TUN" >>"$LOG" 2>&1; TUN_ID=""
fi
if [ -z "$TUN_ID" ]; then
  if try 3 "Creating the tunnel" cloudflared tunnel create "$TUN"; then
    TUN_ID="$(cloudflared tunnel list --name "$TUN" --output json 2>>"$LOG" | jq -r '.[0].id // empty')"
  fi
fi
if [ -n "$TUN_ID" ]; then
  ok "Tunnel $TUN ($TUN_ID)"
  [ -s "$HOME/.cloudflared/$TUN_ID.json" ] && sudo install -m 640 -o root -g "$SVC_USER" "$HOME/.cloudflared/$TUN_ID.json" "$ETC/tunnel.json"
  HOSTS="$PARTY_HOST"
  [ "$HOST_SITE" = yes ] && HOSTS="$HOSTS $DOMAIN www.$DOMAIN"
  {
    echo "tunnel: $TUN_ID"
    echo "credentials-file: $ETC/tunnel.json"
    echo "no-autoupdate: true"
    echo "ingress:"
    for h in $HOSTS; do echo "  - hostname: $h"; echo "    service: http://127.0.0.1:8787"; done
    echo "  - service: http_status:404"
  } | sudo tee "$ETC/tunnel.yml" >/dev/null
  sudo chown root:"$SVC_USER" "$ETC/tunnel.yml"; sudo chmod 640 "$ETC/tunnel.yml"
  for h in $HOSTS; do
    if try 3 "Pointing $h at the Pi" cloudflared tunnel route dns --overwrite-dns "$TUN" "$h"; then ok "$h → this Pi"; else bad "Couldn't set up the address $h (is $DOMAIN on your Cloudflare account?)"; fi
  done
else bad "Couldn't make the tunnel"; fi
printf 'DOMAIN=%s\nPARTY_SUB=%s\nHOST_SITE=%s\nPARTY_HOST=%s\n' "$DOMAIN" "$PARTY_SUB" "$HOST_SITE" "$PARTY_HOST" | sudo tee "$ETC/setup.conf" >/dev/null

# ---------------- 7. services that start by themselves ----------------
step "Making everything start by itself (power cuts, internet drops, moving the Pi)"
SITE_ENV=""; [ "$HOST_SITE" = yes ] && SITE_ENV="Environment=SITE_DIR=$APP/repo"
NODE_BIN="$(command -v node || echo /usr/bin/node)"
CF_BIN="$(command -v cloudflared || echo /usr/bin/cloudflared)"
sudo tee /etc/systemd/system/dash-party.service >/dev/null <<EOF
[Unit]
Description=DASH Parkour party server
After=network.target

[Service]
User=$SVC_USER
Group=$SVC_USER
ExecStart=$NODE_BIN $APP/server.js
Environment=HOST=127.0.0.1
Environment=PORT=8787
Environment=DATA_DIR=$DATA
$SITE_ENV
Restart=always
RestartSec=3
# locked down: it can only write its own data folder and only use the network
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$DATA
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
RestrictSUIDSGID=yes
LockPersonality=yes
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native
MemoryMax=200M

[Install]
WantedBy=multi-user.target
EOF
sudo tee /etc/systemd/system/dash-tunnel.service >/dev/null <<EOF
[Unit]
Description=DASH Parkour Cloudflare tunnel
After=network-online.target dash-party.service
Wants=network-online.target

[Service]
User=$SVC_USER
Group=$SVC_USER
ExecStart=$CF_BIN --no-autoupdate --config $ETC/tunnel.yml tunnel run
Restart=always
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictNamespaces=yes
LockPersonality=yes
CapabilityBoundingSet=
MemoryMax=200M

[Install]
WantedBy=multi-user.target
EOF
sudo tee /etc/systemd/system/dash-watchdog.service >/dev/null <<EOF
[Unit]
Description=DASH Parkour watchdog (checks and fixes the server)

[Service]
Type=oneshot
ExecStart=$APP/dash-watchdog
EOF
sudo tee /etc/systemd/system/dash-watchdog.timer >/dev/null <<EOF
[Unit]
Description=Run the DASH Parkour watchdog every 2 minutes

[Timer]
OnBootSec=90
OnUnitActiveSec=120
AccuracySec=15

[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now dash-party.service >>"$LOG" 2>&1 && ok "Party server running" || bad "The party server didn't start (see: dash-party log)"
if sudo test -s "$ETC/tunnel.json"; then
  sudo systemctl enable dash-tunnel.service >>"$LOG" 2>&1
  sudo systemctl restart dash-tunnel.service >>"$LOG" 2>&1 && ok "Tunnel running" || bad "The tunnel didn't start (see: dash-party log)"
fi
sudo systemctl enable --now dash-watchdog.timer >>"$LOG" 2>&1 && ok "Watchdog checks everything every 2 minutes and fixes what it can"
sudo systemctl enable systemd-networkd-wait-online.service >/dev/null 2>&1 || true

# ---------------- 8. safety ----------------
step "Safety settings"
sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<EOF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
ok "Security updates install by themselves"
if ss -ltn 2>/dev/null | grep -q '0.0.0.0:8787\|\*:8787'; then warn "Port 8787 is open to the network (it should only be on 127.0.0.1)"; else ok "The server only listens inside the Pi (nothing is open to the internet; the tunnel goes out, not in)"; fi
if sudo grep -qE '^\s*PasswordAuthentication\s+yes' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null; then
  warn "SSH accepts passwords: make sure your Pi password is a strong one (README: Safety)"
fi
chmod 700 "$HOME/.cloudflared" 2>/dev/null; chmod 600 "$HOME/.cloudflared/"* 2>/dev/null
ok "Cloudflare login files are private to you ($HOME/.cloudflared)"

# ---------------- 9-12. checks ----------------
step "Checking the server on the Pi"
sleep 3
if curl -fsS -m 5 http://127.0.0.1:8787/api/health >>"$LOG" 2>&1; then ok "Answers on the Pi"; else bad "The server doesn't answer on the Pi (see: dash-party log)"; fi

step "Checking it from the internet (new addresses can take a few minutes)"
UP=no
for i in $(seq 1 "${PUBLIC_TRIES:-30}"); do
  if curl -fsS -m 10 "https://$PARTY_HOST/api/health" >>"$LOG" 2>&1; then UP=yes; break; fi
  sleep 20
done
if [ "$UP" = yes ]; then ok "https://$PARTY_HOST works"; else warn "https://$PARTY_HOST doesn't answer yet. The watchdog keeps trying and fixing; check later with dash-party"; fi
if [ "$HOST_SITE" = yes ]; then
  if curl -fsS -m 10 -o /dev/null "https://$DOMAIN/" >>"$LOG" 2>&1; then ok "https://$DOMAIN works"; else warn "https://$DOMAIN doesn't answer yet (it can take a while)"; fi
fi

step "First watchdog run"
sudo "$APP/dash-watchdog" >>"$LOG" 2>&1 && ok "Watchdog ran" || warn "Watchdog reported a problem (see: dash-party)"

step "Done"
echo
if [ ${#FAILED[@]} -eq 0 ]; then
  echo " ${G}${B}All set!${N} Party server: ${C}https://$PARTY_HOST${N}"
  [ "$HOST_SITE" = yes ] && echo "           Website:      ${C}https://$DOMAIN${N}  (put games in your GitHub repo)"
else
  echo " ${Y}${B}Finished, with problems:${N}"
  for f in "${FAILED[@]}"; do echo "   ${R}✗${N} $f"; done
  echo " Run the same command again to retry (it skips what's already done)."
fi
echo
echo " Type ${C}dash-party${N} any time to see what the server is doing."
echo " Your admin keys: ${C}dash-party keys${N}  (keep them private!)"
echo "===== setup finished $(date), problems: ${#FAILED[@]} =====" >>"$LOG"
