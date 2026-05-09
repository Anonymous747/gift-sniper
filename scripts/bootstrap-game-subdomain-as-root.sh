#!/usr/bin/env bash
# ONE-TIME on the server as root (DigitalOcean “Launch Droplet Console”, login root):
#   sudo bash /opt/gift-sniper/scripts/bootstrap-game-subdomain-as-root.sh
#
# - Lets deploy run provisioning later without a password:
#     sudo bash /opt/gift-sniper/scripts/provision-game-subdomain.sh
# - Runs that provisioning now (nginx + Let’s Encrypt for game.foryou.quest → :3010).

set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Must run as root."
  exit 1
fi

SUDOERS=/etc/sudoers.d/deploy-provision-game
cat >"$SUDOERS" <<'EOF'
deploy ALL=(root) NOPASSWD: /bin/bash /opt/gift-sniper/scripts/provision-game-subdomain.sh
EOF
chmod 440 "$SUDOERS"
visudo -c

exec bash /opt/gift-sniper/scripts/provision-game-subdomain.sh
