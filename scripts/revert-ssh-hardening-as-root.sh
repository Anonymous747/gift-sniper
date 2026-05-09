#!/usr/bin/env bash
# Undo PermitRootLogin no + extra sshd lines from scripts/bootstrap-game-subdomain-as-root.sh era.
# Run ON THE SERVER as root (cloud web console):
#   bash /opt/gift-sniper/scripts/revert-ssh-hardening-as-root.sh

set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Must run as root."
  exit 1
fi

BK=/etc/ssh/sshd_config.bak.before-deploy-user
if [[ -f "$BK" ]]; then
  cp -a "$BK" /etc/ssh/sshd_config
  echo "Restored sshd_config from $BK"
else
  sed -i 's/^PermitRootLogin no/PermitRootLogin yes/' /etc/ssh/sshd_config
  echo "Set PermitRootLogin yes (no backup found at $BK)"
fi

if [[ -f /etc/sudoers.d/deploy-provision-game ]]; then
  rm -f /etc/sudoers.d/deploy-provision-game
  echo "Removed /etc/sudoers.d/deploy-provision-game"
fi
command -v visudo >/dev/null && visudo -c

sshd -t
systemctl reload ssh
echo "Done: root SSH allowed again (PermitRootLogin per restored config). Reload ssh."
