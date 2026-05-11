import { createHash } from 'crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { AlertsService } from '../../alerts/alerts.service';
import { computeSniperScore } from '../../events/sniper-score';
import { EventStreamService } from '../../events/event-stream.service';
import type { NormalizedMarketEvent } from '../../events/normalized-event';
import { analyzeSerial } from '../../lib/beautiful-serial';
import { MetricsService } from '../../metrics/metrics.service';
import { MrktApiService } from './mrkt-api.service';
import type { ExternalListing, FeedResponse } from './mrkt.types';

const PRICE_SIG_MULT = 1_000_000_000;

@Injectable()
export class MrktCollector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MrktCollector.name);
  private readonly pollMs: number;
  private readonly url?: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Last published sale signature per MRKT gift id (nanoTON rounded) — avoids stream spam on unchanged polls */
  private readonly lastSaleSig = new Map<string, number>();
  private loggedCollectorMode = false;

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventStreamService,
    private readonly mrktApi: MrktApiService,
    private readonly alerts: AlertsService,
    private readonly metrics: MetricsService,
  ) {
    this.pollMs = this.config.get<number>('MRKT_POLL_MS') ?? 2000;
    this.url = this.config.get<string>('MRKT_LISTINGS_URL') || undefined;
  }

  onModuleInit() {
    const run = () => {
      void this.pollOnce();
    };
    run();
    this.timer = setInterval(run, this.pollMs);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async pollOnce(): Promise<void> {
    try {
      const mode = this.resolveMode();
      if (!this.loggedCollectorMode) {
        this.loggedCollectorMode = true;
        const preferFeed = this.config.get<string>('MRKT_PREFER_HTTP_FEED')?.trim() === '1';
        let hint: string;
        if (mode === 'api') {
          hint = 'native POST /gifts/saling (full gifts[] — same surface as MRKT mini app)';
        } else if (mode === 'url') {
          hint =
            preferFeed && this.mrktApi.isConfigured()
              ? 'GET MRKT_LISTINGS_URL — MRKT_PREFER_HTTP_FEED=1 forces feed over native API'
              : 'GET MRKT_LISTINGS_URL — set MRKT_TOKEN or MRKT_INIT_DATA to use native API + full traits';
        } else {
          hint = 'mock listings (configure MRKT_TOKEN, MRKT_INIT_DATA, or MRKT_LISTINGS_URL)';
        }
        this.logger.log(`MRKT collector data source: ${mode} — ${hint}`);
      }
      let listings: ExternalListing[] = [];
      if (mode === 'url' && this.url) {
        listings = await this.fetchRemote(this.url);
        this.pruneSnapshot(listings);
        for (const item of listings) {
          if (!this.shouldPublishLive(item)) continue;
          await this.publishAndMaybeFastAlert(item, { stableEventId: true, mockVelocity: false });
        }
      } else if (mode === 'api') {
        listings = await this.mrktApi.fetchSaleListings();
        this.pruneSnapshot(listings);
        for (const item of listings) {
          if (!this.shouldPublishLive(item)) continue;
          await this.publishAndMaybeFastAlert(item, { stableEventId: true, mockVelocity: false });
        }
      } else {
        for (const item of this.mockListings()) {
          await this.publishAndMaybeFastAlert(item, { stableEventId: false, mockVelocity: true });
        }
      }
      this.metrics.bumpCollectorPoll(true);
    } catch (err) {
      this.metrics.bumpCollectorPoll(false);
      this.logger.warn(`MRKT poll failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async publishAndMaybeFastAlert(
    item: ExternalListing,
    opts: { stableEventId: boolean; mockVelocity: boolean },
  ): Promise<void> {
    const norm = this.normalize(item, opts);
    await this.events.publish(norm);
    if (this.config.get<string>('FAST_ALERT_FROM_COLLECTOR') !== '0') {
      const score = computeSniperScore(norm);
      void this.alerts.notifyMatchingUsers(norm, score).catch((e) =>
        this.logger.warn(`Fast-path alert failed: ${e instanceof Error ? e.message : e}`),
      );
    }
  }

  /**
   * Same as typical MRKT bots: **native API first** (`MRKT_TOKEN` / `MRKT_INIT_DATA` → `/gifts/saling` full `gifts[]`).
   * HTTP GET `MRKT_LISTINGS_URL` is a fallback only when the API is not configured.
   * Set `MRKT_PREFER_HTTP_FEED=1` to force the URL feed when both URL and API credentials exist (legacy).
   */
  private resolveMode(): 'url' | 'api' | 'mock' {
    const preferHttpFeed = this.config.get<string>('MRKT_PREFER_HTTP_FEED')?.trim() === '1';
    if (preferHttpFeed && this.url) return 'url';
    if (this.mrktApi.isConfigured()) return 'api';
    if (this.url) return 'url';
    return 'mock';
  }

  private shouldPublishLive(item: ExternalListing): boolean {
    const sig = Math.round(item.price_ton * PRICE_SIG_MULT);
    const prev = this.lastSaleSig.get(item.gift_id);
    if (prev === sig) return false;
    this.lastSaleSig.set(item.gift_id, sig);
    return true;
  }

  private pruneSnapshot(listings: ExternalListing[]): void {
    if (listings.length === 0) return;
    const seen = new Set(listings.map((l) => l.gift_id));
    for (const key of [...this.lastSaleSig.keys()]) {
      if (!seen.has(key)) this.lastSaleSig.delete(key);
    }
  }

  private async fetchRemote(url: string): Promise<ExternalListing[]> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as FeedResponse;
      if (Array.isArray(body)) return body;
      if (body && Array.isArray(body.listings)) return body.listings;
      return [];
    } finally {
      clearTimeout(t);
    }
  }

  private mockListings(): ExternalListing[] {
    const collection = ['Sakura', 'Neon', 'Obsidian'][randomInt(0, 3)]!;
    const serial = randomInt(1, 9999);
    const floor = 3 + randomInt(0, 80) / 10;
    const discountChance = randomInt(0, 100);
    const price =
      discountChance < 35 ? floor * (0.55 + randomInt(0, 35) / 100) : floor * (0.95 + randomInt(0, 10) / 100);
    const giftId = `${collection.toLowerCase()}-${serial}`;
    const models = ['Bite-Size', 'Classic', 'Albino', 'Gold Bar'];
    const backdrops = ['Battleship Grey', 'Grape', 'Midnight', 'Sky Blue'];
    const symbols = ['Chili', 'Star', 'Lemon', 'Panda'];
    return [
      {
        gift_id: giftId,
        collection,
        gift_name: `${collection} #${serial}`,
        gift_model: models[randomInt(0, models.length)]!,
        gift_backdrop: backdrops[randomInt(0, backdrops.length)]!,
        gift_symbol: symbols[randomInt(0, symbols.length)]!,
        serial_number: serial,
        price_ton: Number(price.toFixed(2)),
        floor_price_collection: Number(floor.toFixed(2)),
        floor_price_backdrop_model: Number((floor * 1.08).toFixed(2)),
        floor_price: Number(floor.toFixed(2)),
        seller_id: 'seller_mock',
        seller_name: 'mock_seller',
        rarity_rank: randomInt(1, 500),
        rarity_score: randomInt(50, 99) / 100,
      },
    ];
  }

  private normalize(
    item: ExternalListing,
    opts: { stableEventId: boolean; mockVelocity: boolean },
  ): NormalizedMarketEvent {
    const floor = item.floor_price ?? null;
    const below =
      floor != null && floor > 0 ? Number((((floor - item.price_ton) / floor) * 100).toFixed(2)) : null;
    const floorCollection = item.floor_price_collection ?? null;
    const floorBackdropModel = item.floor_price_backdrop_model ?? null;
    const event_id = opts.stableEventId
      ? `mrkt:${item.gift_id}:${Math.round(item.price_ton * PRICE_SIG_MULT)}`
      : uuidv4();
    let velocity: string | undefined;
    if (opts.mockVelocity && randomInt(0, 10) < 2) velocity = 'high';
    const serialAnalysis = analyzeSerial(item.serial_number ?? null);
    const content_fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          g: item.gift_id,
          p: item.price_ton,
          f: floor,
          c: item.collection,
        }),
      )
      .digest('hex')
      .slice(0, 16);
    return {
      event_id,
      market: 'mrkt',
      event_type: 'listing',
      gift_id: item.gift_id,
      collection: item.collection,
      collection_slug: item.collection_slug,
      nft_telegram_suffix: item.nft_telegram_suffix,
      collection_display: item.collection_display,
      gift_name: item.gift_name,
      gift_model: item.gift_model ?? null,
      gift_backdrop: item.gift_backdrop ?? null,
      gift_symbol: item.gift_symbol ?? null,
      serial_number: item.serial_number ?? null,
      price_ton: item.price_ton,
      floor_price_collection: floorCollection,
      floor_price_backdrop_model: floorBackdropModel,
      floor_price: floor,
      below_floor_percent: below,
      rarity_rank: item.rarity_rank ?? null,
      rarity_score: item.rarity_score ?? null,
      seller_id: item.seller_id ?? null,
      seller_name: item.seller_name ?? null,
      timestamp: Date.now(),
      velocity,
      content_fingerprint,
      beautiful_serial: serialAnalysis.viral,
      beautiful_label: serialAnalysis.label,
    };
  }
}
