#!/usr/bin/env bash
# Run ON THE SERVER as root (e.g. DigitalOcean droplet web console):
#   sudo bash /opt/gift-sniper/scripts/provision-game-subdomain.sh
#
# Creates nginx vhost game.foryou.quest → 127.0.0.1:3010 and obtains Let's Encrypt cert.
# Optional: CERTBOT_EMAIL=you@domain.com for Let's Encrypt registration.

set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Must run as root (use: sudo bash $0)"
  exit 1
fi

SITE_AVAIL=/etc/nginx/sites-available/game.foryou.quest
DOMAIN=game.foryou.quest
UPSTREAM=http://127.0.0.1:3010
WEBROOT=/var/www/html

write_http_only() {
  cat >"$SITE_AVAIL" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    location / {
        proxy_pass ${UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
}

write_https() {
  cat >"$SITE_AVAIL" <<NGINX
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    location / {
        proxy_pass ${UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
NGINX
}

ln -sf "$SITE_AVAIL" /etc/nginx/sites-enabled/game.foryou.quest

if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  echo "Certificate already present for ${DOMAIN}; updating nginx only."
  write_https
else
  echo "Staging HTTP vhost + requesting certificate..."
  write_http_only
  nginx -t
  systemctl reload nginx

  CERTBOT_ARGS=(
    certonly --webroot -w "${WEBROOT}" -d "${DOMAIN}"
    --non-interactive --agree-tos --keep-until-expiring
  )
  if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
    certbot "${CERTBOT_ARGS[@]}" --email "${CERTBOT_EMAIL}"
  else
    certbot "${CERTBOT_ARGS[@]}" --register-unsafely-without-email
  fi

  write_https
fi

nginx -t
systemctl reload nginx

echo "OK: https://${DOMAIN}/mini — verify with: curl -sSI https://${DOMAIN}/mini"
