import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BINANCE_TON_USDT =
  'https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT';
const COINGECKO_TON =
  'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd';

@Injectable()
export class TonUsdRateService {
  private readonly logger = new Logger(TonUsdRateService.name);
  /** Last successful spot (approx. USD per 1 TON). */
  private lastGood: number | null = null;
  /** In-memory cache deadline (ms since epoch). */
  private cacheUntil = 0;

  constructor(private readonly config: ConfigService) {}

  /**
   * USD-per-TON for alert copy: Binance `TONUSDT`, then CoinGecko `the-open-network` vs `usd`.
   * On fetch failure, returns the last successful value if any.
   */
  async getEffectiveRate(): Promise<number | null> {
    const now = Date.now();
    if (now < this.cacheUntil && this.lastGood != null) {
      return this.lastGood;
    }

    const ttlMs = this.cacheTtlMs();
    const spot = (await this.fetchBinanceTonUsdt()) ?? (await this.fetchCoinGeckoTonUsd());
    if (spot != null) {
      this.lastGood = spot;
      this.cacheUntil = now + ttlMs;
      return spot;
    }

    if (this.lastGood != null) {
      this.logger.warn('TON/USD spot fetch failed; using last successful rate');
      return this.lastGood;
    }
    this.logger.debug('TON/USD unavailable (no cache, fetch failed)');
    return null;
  }

  private cacheTtlMs(): number {
    const raw = this.config.get<number>('TON_USD_CACHE_SEC');
    const sec = raw != null && Number.isFinite(raw) && raw > 0 ? raw : 300;
    return Math.min(Math.max(sec, 60), 3600) * 1000;
  }

  private async fetchBinanceTonUsdt(): Promise<number | null> {
    try {
      const res = await fetch(BINANCE_TON_USDT, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { price?: string };
      const n = data.price != null ? Number(data.price) : NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch (e) {
      this.logger.debug(`Binance TON price: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  private async fetchCoinGeckoTonUsd(): Promise<number | null> {
    try {
      const res = await fetch(COINGECKO_TON, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { 'the-open-network'?: { usd?: number } };
      const n = data['the-open-network']?.usd;
      return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
    } catch (e) {
      this.logger.debug(`CoinGecko TON price: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }
}
