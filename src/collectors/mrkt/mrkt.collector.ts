import { createHash } from 'crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { AlertsService } from '../../alerts/alerts.service';
import { computeSniperScore } from '../../events/sniper-score';
import { EventStreamService } from '../../events/event-stream.service';
import type { NormalizedMarketEvent } from '../../events/normalized-event';
import { analyzeSerial } from '../../lib/beautiful-serial';
import { MetricsService } from '../../metrics/metrics.service';
import { MrktApiService } from './mrkt-api.service';
import { MrktPublicCatalogService } from './mrkt-public-catalog.service';
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
  /** When true (default), normalize gift series label via public GET `/gifts/collections`. */
  private readonly catalogEnrich: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventStreamService,
    private readonly mrktApi: MrktApiService,
    private readonly alerts: AlertsService,
    private readonly metrics: MetricsService,
    private readonly mrktCatalog: MrktPublicCatalogService,
  ) {
    this.pollMs = this.config.get<number>('MRKT_POLL_MS') ?? 2000;
    this.url = this.config.get<string>('MRKT_LISTINGS_URL') || undefined;
    this.catalogEnrich = this.config.get<string>('MRKT_CATALOG_ENRICH')?.trim() !== '0';
  }

  onModuleInit() {
    if (this.catalogEnrich) {
      void this.mrktCatalog.getGiftCollections({ includeHidden: true }).catch((err) =>
        this.logger.debug(`MRKT catalog warmup failed (non-fatal): ${err instanceof Error ? err.message : err}`),
      );
    }
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
              : 'GET MRKT_LISTINGS_URL — set MRKT_TOKEN or MRKT_INIT_DATA for native API + full traits';
        } else {
          hint =
            'idle — set MRKT_TOKEN or MRKT_INIT_DATA (native API) and/or MRKT_LISTINGS_URL; no synthetic listings';
        }
        const logLine = `MRKT collector data source: ${mode} — ${hint}`;
        if (mode === 'disabled') {
          this.logger.warn(`${logLine} (Telegram bot will not receive MRKT listings until MRKT is configured.)`);
          this.logMrktDisabledHints();
        } else {
          this.logger.log(logLine);
        }
      }
      let listings: ExternalListing[] = [];
      if (mode === 'url' && this.url) {
        listings = await this.fetchRemote(this.url);
        this.pruneSnapshot(listings);
        for (const item of listings) {
          if (!this.shouldPublishLive(item)) continue;
          const row = await this.enrichCollectionFromCatalog(item);
          await this.publishAndMaybeFastAlert(row, { stableEventId: true });
        }
      } else if (mode === 'api') {
        listings = await this.mrktApi.fetchSaleListings();
        this.pruneSnapshot(listings);
        for (const item of listings) {
          if (!this.shouldPublishLive(item)) continue;
          const row = await this.enrichCollectionFromCatalog(item);
          await this.publishAndMaybeFastAlert(row, { stableEventId: true });
        }
      }
      this.metrics.bumpCollectorPoll(true);
    } catch (err) {
      this.metrics.bumpCollectorPoll(false);
      this.logger.warn(`MRKT poll failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Prefer MRKT mini-app catalog titles over raw `/gifts/saling` strings (spacing, casing, aliases). */
  private async enrichCollectionFromCatalog(item: ExternalListing): Promise<ExternalListing> {
    if (!this.catalogEnrich) return item;
    try {
      const canon = await this.mrktCatalog.resolveCanonicalCollectionDisplay(item);
      if (!canon) return item;
      return { ...item, collection_display: canon };
    } catch (err) {
      this.logger.debug(`Catalog enrich skipped: ${err instanceof Error ? err.message : err}`);
      return item;
    }
  }

  private async publishAndMaybeFastAlert(item: ExternalListing, opts: { stableEventId: boolean }): Promise<void> {
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
   * **Native API first** (`MRKT_TOKEN` / `MRKT_INIT_DATA` → `/gifts/saling`).
   * HTTP GET `MRKT_LISTINGS_URL` when API auth is unset or when `MRKT_PREFER_HTTP_FEED=1`.
   * No synthetic listings — configure MRKT or an HTTP feed for live data.
   */
  /** Keys exist but values empty — common misconfig from template `.env` (`MRKT_TOKEN=""`). */
  private logMrktDisabledHints(): void {
    const rawTok = this.config.get<string>('MRKT_TOKEN');
    const rawInit = this.config.get<string>('MRKT_INIT_DATA');
    const rawUrl = this.config.get<string>('MRKT_LISTINGS_URL');
    if (rawTok !== undefined && rawTok.trim().length === 0) {
      this.logger.warn(
        'MRKT_TOKEN is present but empty — native POST /gifts/saling will not run. Set a real token (Telegram Web → MRKT mini app → Network → api.tgmrkt.io /auth or refresh MRKT_TOKEN).',
      );
    }
    if (rawInit !== undefined && rawInit.trim().length === 0) {
      this.logger.warn('MRKT_INIT_DATA is present but empty — MRKT auth via init_data disabled.');
    }
    if (rawUrl !== undefined && rawUrl.trim().length === 0) {
      this.logger.warn(
        'MRKT_LISTINGS_URL is present but empty — optional HTTP JSON feed disabled (unset the key or set a URL).',
      );
    }
  }

  private resolveMode(): 'url' | 'api' | 'disabled' {
    const preferHttpFeed = this.config.get<string>('MRKT_PREFER_HTTP_FEED')?.trim() === '1';
    if (preferHttpFeed && this.url) return 'url';
    if (this.mrktApi.isConfigured()) return 'api';
    if (this.url) return 'url';
    return 'disabled';
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

  private normalize(item: ExternalListing, opts: { stableEventId: boolean }): NormalizedMarketEvent {
    const floor = item.floor_price ?? null;
    const below =
      floor != null && floor > 0 ? Number((((floor - item.price_ton) / floor) * 100).toFixed(2)) : null;
    const floorCollection = item.floor_price_collection ?? null;
    const floorBackdropModel = item.floor_price_backdrop_model ?? null;
    const event_id = opts.stableEventId
      ? `mrkt:${item.gift_id}:${Math.round(item.price_ton * PRICE_SIG_MULT)}`
      : uuidv4();
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
      gifts_collection_id: item.gifts_collection_id,
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
      content_fingerprint,
      beautiful_serial: serialAnalysis.viral,
      beautiful_label: serialAnalysis.label,
    };
  }
}
