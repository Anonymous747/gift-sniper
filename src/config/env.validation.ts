import { plainToInstance } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsOptional()
  @IsString()
  TELEGRAM_BOT_TOKEN?: string;

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
  if (
    normalized.MRKT_SALING_MAX_PAGES !== undefined &&
    typeof normalized.MRKT_SALING_MAX_PAGES === 'string'
  ) {
    normalized.MRKT_SALING_MAX_PAGES = parseInt(normalized.MRKT_SALING_MAX_PAGES as string, 10);
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
