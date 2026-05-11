import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NormalizedMarketEvent } from '../events/normalized-event';
import {
  giftTelegramDisplayUrl,
  giftTelegramDisplayUrlForMrktListing,
  starGiftSlugKeyFromMrktTitle,
} from '../lib/mrkt-telegram-link';

const DEFAULT_API_BASE = 'https://api.tgmrkt.io/api/v1';

/**
 * Validates `t.me/nft/{Key}-{serial}` keys against MRKT’s public `/gifts/collections` —
 * MRKT sometimes sends bogus `nftTelegramSuffix` (e.g. Neon-* instead of Fragment’s real slug).
 */
@Injectable()
export class GiftTelegramLinkResolverService {
  private readonly logger = new Logger(GiftTelegramLinkResolverService.name);
  private cache: { at: number; keys: Set<string> } | null = null;
  private readonly ttlMs: number;

  constructor(private readonly config: ConfigService) {
    this.ttlMs = Number(this.config.get<string>('MRKT_CATALOG_CACHE_MS') ?? 900_000) || 900_000;
  }

  private apiBase(): string {
    return (this.config.get<string>('MRKT_API_BASE') ?? DEFAULT_API_BASE).replace(/\/$/, '');
  }

  async getTelegramStarGiftSlugKeys(): Promise<Set<string>> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < this.ttlMs) {
      return this.cache.keys;
    }

    const keys = new Set<string>();
    try {
      const res = await fetch(`${this.apiBase()}/gifts/collections`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(`MRKT collections GET ${res.status}: ${text.slice(0, 120)}`);
        this.cache = { at: now, keys };
        return keys;
      }
      const raw = (await res.json()) as unknown;
      if (!Array.isArray(raw)) {
        this.cache = { at: now, keys };
        return keys;
      }
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const title = typeof o.title === 'string' ? o.title.trim() : '';
        const name = typeof o.name === 'string' ? o.name.trim() : '';
        for (const label of [title, name]) {
          if (!label || !/[a-zA-Z\u00c0-\u024f]/i.test(label)) continue;
          const key = starGiftSlugKeyFromMrktTitle(label);
          if (key.length > 0) keys.add(key);
        }
      }
    } catch (e) {
      this.logger.warn(
        `MRKT collections fetch failed; NFT deep links disabled until next cache window: ${
          e instanceof Error ? e.message : e
        }`,
      );
    }
    this.cache = { at: now, keys };
    return keys;
  }

  /** Safe primary URL for listing cards (MRKT: mini-app or validated `t.me/nft`). */
  async displayUrlForListing(event: NormalizedMarketEvent): Promise<string | null> {
    if (event.market !== 'mrkt') {
      return giftTelegramDisplayUrl(event);
    }
    const keys = await this.getTelegramStarGiftSlugKeys();
    return giftTelegramDisplayUrlForMrktListing(event, keys);
  }
}
