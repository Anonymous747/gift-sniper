# Production server inventory (non-sensitive)

This file records **facts only** (no secrets, no `.env` contents). Refresh after deploys or infra changes.

## Connection

| Item | Value |
|------|--------|
| IPv4 | `159.65.200.191` |
| SSH | **`root@159.65.200.191 -p 22`** |
| Note | Port **8080** does not accept SSH (`Connection closed`) — use **22** unless your provider documents otherwise. |

## Host

| Item | Last verified (UTC) |
|------|----------------------|
| Hostname | `Amster` |
| Checked | 2026-05-11 |

## Application deploy

| Item | Value |
|------|--------|
| Path | `/opt/gift-sniper` |
| Owner | Mostly `deploy:deploy`; some files `root` (e.g. `.env.example`, README after deploy) |
| `.env` present | Yes (~1708 bytes as of check — **do not commit contents**) |
| Git branch | `main` tracking `origin/main` |
| Git HEAD | `0bda31e` (at time of inventory) |

## Docker Compose

| Service | Status (snapshot) |
|---------|-------------------|
| `app` | Up, `0.0.0.0:3010->3000/tcp` |
| `postgres` | Up (healthy) |
| `redis` | Up (healthy) |
| Compose | Docker Compose v5.1.1 |

## Health endpoint (`GET /health`)

Snapshot from **inside** host: `curl http://127.0.0.1:3010/health`

```json
{"ok":true,"database":true,"telegramTokenConfigured":true,"telegramLongPolling":true}
```

- **`ok: true`** implies DB reachable, Telegram bot token configured, grammY long polling active.
- Extra flags (`mrktNativeAuthConfigured`, etc.) appear after deploying a build that includes the extended health controller.

## Capacity warning

Root filesystem **~87% used** (~42G / 48G) — plan cleanup or resize before full.

## MRKT ingestion (diagnostics)

When the app logs **`MRKT collector data source: disabled`**, the process **does not see usable MRKT credentials**:

- **`MRKT_TOKEN`** or **`MRKT_INIT_DATA`** must be non-empty for native **`POST /gifts/saling`**.
- Inside the container, `printenv MRKT_TOKEN` should show a **non-empty** value (length ≫ 0).

**Verified issue (2026-05-11):** host `/opt/gift-sniper/.env` contained **`MRKT_TOKEN=""`** (empty quoted string). Docker loaded it correctly — the token was literally empty, so **`MrktApiService.isConfigured()`** was false. **Fix:** replace with a valid session token (do not commit); then `docker compose up -d --force-recreate app` (or restart) so the container picks up the file.

## Maintenance checklist

1. After each deploy: confirm `git rev-parse HEAD` on server matches intended release.
2. Compare `/health` with expectations (`telegramTokenConfigured`, MRKT-related booleans when shipped).
3. Never paste tokens or full `.env` into this repo.
