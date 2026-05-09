import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import type { NormalizedMarketEvent } from '../events/normalized-event';
import { slugifyCollectionName } from '../lib/mrkt-telegram-link';

export type ArbitrageOpportunity = {
  collectionKey: string;
  serial: number;
  spreadPct: number;
  cheapMarket: string;
  expensiveMarket: string;
  cheapPrice: number;
  expensivePrice: number;
};

const REDIS_KEY_PREFIX = 'arb:px:';

@Injectable()
export class ArbitrageEngineService {
  private readonly minSpreadPct: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    const raw = config.get<string>('ARBIT_MIN_SPREAD_PCT');
    const n = raw != null ? Number(raw) : 12;
    this.minSpreadPct = Number.isFinite(n) && n > 0 ? n : 12;
  }

  /**
   * Records latest ask/listing price per market for collection+serial; returns spread if ≥ threshold.
   */
  async onListing(event: NormalizedMarketEvent): Promise<ArbitrageOpportunity | null> {
    if (event.event_type !== 'listing') return null;
    if (event.serial_number == null || event.price_ton == null || event.price_ton <= 0) return null;

    const collectionKey = `${slugifyCollectionName(event.collection)}`;
    const field = event.market;
    const key = `${REDIS_KEY_PREFIX}${collectionKey}:${event.serial_number}`;

    await this.redis.client.hset(key, field, String(event.price_ton));
    await this.redis.client.expire(key, 86_400);

    const all = await this.redis.client.hgetall(key);
    const entries = Object.entries(all).filter(
      ([m, p]) => m.length > 0 && p != null && Number(p) > 0,
    ) as [string, string][];
    if (entries.length < 2) return null;

    let minM = '';
    let maxM = '';
    let minP = Infinity;
    let maxP = 0;
    for (const [m, ps] of entries) {
      const p = Number(ps);
      if (!Number.isFinite(p) || p <= 0) continue;
      if (p < minP) {
        minP = p;
        minM = m;
      }
      if (p > maxP) {
        maxP = p;
        maxM = m;
      }
    }
    if (!minM || !maxM || minM === maxM || minP <= 0 || maxP <= 0) return null;
    const spreadPct = ((maxP - minP) / minP) * 100;
    if (spreadPct < this.minSpreadPct) return null;

    return {
      collectionKey,
      serial: event.serial_number,
      spreadPct,
      cheapMarket: minM,
      expensiveMarket: maxM,
      cheapPrice: minP,
      expensivePrice: maxP,
    };
  }
}
