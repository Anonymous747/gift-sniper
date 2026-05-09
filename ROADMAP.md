# Gift Sniper — product & engineering roadmap

This file captures the strategic direction discussed for Gift Sniper: what is **done in code today**, what is **stubbed**, and what remains **future work**.

## Already shipped (foundation)

| Area | Status |
|------|--------|
| Redis Streams decoupling | Live — `EventStreamService` + `StreamConsumerService` |
| Normalized events (`market`, `event_type`, …) | Live — `NormalizedMarketEvent` |
| Per-market collectors layout | Live — `collectors/mrkt/` + **Tonnel/Portals placeholders** |
| Filter engine + per-user criteria | Live |
| Redis alert dedupe | Live |
| MRKT Mini App deep link in alerts | Live |
| **Metrics** (`/metrics` Prometheus, `/metrics/json`) | Live |
| **Fast-path alerts** (collector → Telegram before DB finishes) | Live — optional `FAST_ALERT_FROM_COLLECTOR`, dedupe prevents double sends |
| **Ingestion-only alerts mode** | Live — `ALERTS_FROM_FAST_PATH_ONLY=1` skips ingestion-side notify |
| **Socket.IO gateway** (`EventsGateway`) + `listing` broadcast after DB persist | Live |
| **Beautiful serial** heuristics + sniper bonus + optional second Telegram | Live — `src/lib/beautiful-serial.ts` |
| **Extended sniper score** (discount, rarity, serial beauty, velocity, optional demand/whale fields on event) | Live — placeholders on event for future collectors |
| **Content fingerprint** on normalized listing events | Live — `content_fingerprint` |
| **Admin** `GET /admin/stats`, `POST /admin/replay` | Live — `X-Admin-Token` + `ADMIN_TOKEN` |
| **Whale / collection analytics** | **Stubs** — `IntelligenceModule` |

## Priority 1 — Latency (ongoing tuning)

- **Done:** collector can fire alerts immediately after `publish()`; dedupe aligns with ingestion path.
- **Next:** measure end-to-end ms under load (`metrics` + external APM); consider trimming duplicate filter DB work when both paths run (e.g. default to fast-path-only in prod with `ALERTS_FROM_FAST_PATH_ONLY=1`).

## Priority 2 — Multi-market

- **Done:** `TonnelCollector` / `PortalsCollector` stubs + env toggles (`TONNEL_ENABLED`, `PORTALS_ENABLED`).
- **Next:** real API clients + mappers emitting the same `NormalizedMarketEvent` contract.

## Priority 3 — Sniper scoring “intelligence”

- **Done:** richer serial component + optional `collection_demand_score` / `whale_activity_score` on events (defaults unset).
- **Next:** populate those fields from market-specific signals; version the score formula if user-facing filters depend on it.

## Priority 4 — Beautiful serial / viral feed

- **Done:** pattern analysis, listing text line, optional second message + dedupe `dedupe:beautiful:…`.
- **Next:** A/B copy, user preference to mute “viral” extras only.

## Priority 5 — Whale tracking

- **Stub:** `WhaleTrackingService`.
- **Next:** schema for wallets, ingestion from MRKT sellers / on-chain, `smart_money_score`.

## Priority 6 — Collection analytics

- **Stub:** `CollectionAnalyticsService`; Prisma already has `AnalyticsSnapshot` for rollups.
- **Next:** floor history job, sales/hour, unique buyers, trend flags → snapshot writer.

## Priority 7 — WebSocket / Mini App

- **Done:** server broadcasts `listing` after successful ingestion persist.
- **Next:** auth namespaces, rate limits, Mini App client subscribing with JWT.

## Ops additions

| Item | Status |
|------|--------|
| Metrics export | `/metrics`, `/metrics/json` |
| Replay | `POST /admin/replay` `{ "max": 50 }` (chronological replay, idempotent via `eventUuid`) |
| Admin dashboard UI | Not started — stats JSON is API-ready |

## Explicit non-goals (for now)

- Heavy ML / “AI price prediction” ahead of data volume and latency SLOs  
- Auto-trading / custody  
- Huge BI dashboards before core latency + second market are proven  

---

**Principle:** ship **fast, honest alerts** and **clean data planes** first; intelligence layers compound on top.
