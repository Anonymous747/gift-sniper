import { plainToInstance } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsOptional()
  @IsString()
  TELEGRAM_BOT_TOKEN?: string;

  @IsOptional()
  @IsString()
  LOG_TELEGRAM_UPDATES?: string;

  @IsOptional()
  @IsString()
  TELEGRAM_DROP_PENDING_UPDATES?: string;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  REDIS_URL!: string;

  @IsOptional()
  @IsString()
  MRKT_LISTINGS_URL?: string;

  /** Direct MRKT session token (from Web Telegram Network tab or auth flow). */
  @IsOptional()
  @IsString()
  MRKT_TOKEN?: string;

  /** Telegram Mini App `init_data` string for POST /auth when MRKT_TOKEN is not set. */
  @IsOptional()
  @IsString()
  MRKT_INIT_DATA?: string;

  @IsOptional()
  @IsString()
  MRKT_API_BASE?: string;

  /** CDN origin for sticker paths from MRKT catalog (`modelStickerThumbnailKey`). */
  @IsOptional()
  @IsString()
  MRKT_CDN_BASE?: string;

  /** TTL (ms) for in-memory MRKT `/gifts/collections` + `/gifts/models` cache. */
  @IsOptional()
  @IsInt()
  @Min(60_000)
  @Max(86_400_000)
  MRKT_CATALOG_CACHE_MS?: number;

  /** Optional JSON merged into default POST /gifts/saling body (camelCase keys). */
  @IsOptional()
  @IsString()
  MRKT_SALING_JSON?: string;

  @IsOptional()
  @IsString()
  MRKT_USER_AGENT?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  MRKT_SALING_MAX_PAGES?: number;

  @IsOptional()
  @IsInt()
  @Min(250)
  MRKT_POLL_MS?: number;

  @IsOptional()
  @IsString()
  EVENT_STREAM_KEY?: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  ALERT_DEDUPE_TTL_SEC?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  FREE_TIER_ALERT_DELAY_MS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  APP_PORT?: number;

  /** Protects `GET /admin/stats` and `POST /admin/replay` (header `X-Admin-Token`). */
  @IsOptional()
  @IsString()
  ADMIN_TOKEN?: string;

  /** When `1`, skip Telegram alerts from ingestion (collector fast-path only). */
  @IsOptional()
  @IsString()
  ALERTS_FROM_FAST_PATH_ONLY?: string;

  /** Set to `0` to disable collector-side alerts (stream → ingestion path only). Default: fast path on. */
  @IsOptional()
  @IsString()
  FAST_ALERT_FROM_COLLECTOR?: string;

  @IsOptional()
  @IsString()
  TONNEL_ENABLED?: string;

  @IsOptional()
  @IsString()
  PORTALS_ENABLED?: string;

  /** JSON array of intel channels — see README. */
  @IsOptional()
  @IsString()
  INTEL_CHANNELS_JSON?: string;

  /** When `1`, post listing/arbitrage messages to `IntelFeedChannel` Telegram chats. */
  @IsOptional()
  @IsString()
  INTEL_FEED_POSTING_ENABLED?: string;

  /** Minimum cross-market spread % to broadcast arbitrage (Redis hash per collection+serial). */
  @IsOptional()
  @IsString()
  ARBIT_MIN_SPREAD_PCT?: string;

  /** Max age (seconds) for Mini App `initData` auth_date validation. */
  @IsOptional()
  @IsString()
  TWA_MAX_AUTH_AGE_SEC?: string;

  /** Optional absolute base URL for Mini App shell fetch (production: https://game.foryou.quest). */
  @IsOptional()
  @IsString()
  PUBLIC_APP_BASE_URL?: string;

  /** Cache TTL (seconds) for fetched TON/USD spot. */
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(3600)
  TON_USD_CACHE_SEC?: number;
}

export function validateEnv(config: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {
    EVENT_STREAM_KEY: 'gifts:events:v1',
    ALERT_DEDUPE_TTL_SEC: 300,
    FREE_TIER_ALERT_DELAY_MS: 0,
    MRKT_POLL_MS: 2000,
    MRKT_SALING_MAX_PAGES: 3,
    ...config,
  };
  if (normalized.MRKT_POLL_MS !== undefined && typeof normalized.MRKT_POLL_MS === 'string') {
    normalized.MRKT_POLL_MS = parseInt(normalized.MRKT_POLL_MS as string, 10);
  }
  if (normalized.ALERT_DEDUPE_TTL_SEC !== undefined && typeof normalized.ALERT_DEDUPE_TTL_SEC === 'string') {
    normalized.ALERT_DEDUPE_TTL_SEC = parseInt(normalized.ALERT_DEDUPE_TTL_SEC as string, 10);
  }
  if (normalized.FREE_TIER_ALERT_DELAY_MS !== undefined && typeof normalized.FREE_TIER_ALERT_DELAY_MS === 'string') {
    normalized.FREE_TIER_ALERT_DELAY_MS = parseInt(normalized.FREE_TIER_ALERT_DELAY_MS as string, 10);
  }
  if (normalized.PORT !== undefined && typeof normalized.PORT === 'string') {
    normalized.PORT = parseInt(normalized.PORT as string, 10);
  }
  if (normalized.APP_PORT !== undefined && typeof normalized.APP_PORT === 'string') {
    normalized.APP_PORT = parseInt(normalized.APP_PORT as string, 10);
  }
  if (
    normalized.MRKT_SALING_MAX_PAGES !== undefined &&
    typeof normalized.MRKT_SALING_MAX_PAGES === 'string'
  ) {
    normalized.MRKT_SALING_MAX_PAGES = parseInt(normalized.MRKT_SALING_MAX_PAGES as string, 10);
  }
  if (
    normalized.MRKT_CATALOG_CACHE_MS !== undefined &&
    typeof normalized.MRKT_CATALOG_CACHE_MS === 'string'
  ) {
    normalized.MRKT_CATALOG_CACHE_MS = parseInt(normalized.MRKT_CATALOG_CACHE_MS as string, 10);
  }
  if (
    normalized.TON_USD_CACHE_SEC !== undefined &&
    typeof normalized.TON_USD_CACHE_SEC === 'string'
  ) {
    normalized.TON_USD_CACHE_SEC = parseInt(normalized.TON_USD_CACHE_SEC as string, 10);
  }

  const validated = plainToInstance(EnvironmentVariables, normalized, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length) {
    const msg = errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; ');
    throw new Error(`Env validation failed: ${msg}`);
  }
  return validated;
}
