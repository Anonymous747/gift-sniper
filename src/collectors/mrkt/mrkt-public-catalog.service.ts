import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { starGiftSlugKeyFromMrktTitle } from '../../lib/mrkt-telegram-link';
import type { ExternalListing } from './mrkt.types';

const DEFAULT_API_BASE = 'https://api.tgmrkt.io/api/v1';
const DEFAULT_CDN_BASE = 'https://cdn.tgmrkt.io';

export type TelegramGiftCatalogRow = {
  /** Canonical display title from MRKT `GET /gifts/collections` (`title`). */
  collectionTitle: string;
  /** Second label from API (`name`) — used for matching only. */
  collectionName?: string;
  /** Stable id when API sends it — authoritative match for series. */
  collectionId?: string;
  stickerUrl: string | null;
  isHidden: boolean;
};

export type TelegramGiftModelRow = {
  modelName: string;
  rarityPercent: number | null;
  stickerUrl: string | null;
};

type Cache<T> = { at: number; data: T };

@Injectable()
export class MrktPublicCatalogService {
  private readonly logger = new Logger(MrktPublicCatalogService.name);
  private readonly ttlMs: number;

  private collectionsCache: Cache<TelegramGiftCatalogRow[]> | null = null;
  private readonly modelsCache = new Map<string, Cache<TelegramGiftModelRow[]>>();

  constructor(private readonly config: ConfigService) {
    this.ttlMs = Number(this.config.get<string>('MRKT_CATALOG_CACHE_MS') ?? 900_000) || 900_000;
  }

  private apiBase(): string {
    return (this.config.get<string>('MRKT_API_BASE') ?? DEFAULT_API_BASE).replace(/\/$/, '');
  }

  private cdnBase(): string {
    return (this.config.get<string>('MRKT_CDN_BASE') ?? DEFAULT_CDN_BASE).replace(/\/$/, '');
  }

  stickerUrl(key: string | undefined | null): string | null {
    if (!key?.trim()) return null;
    return `${this.cdnBase()}/${key.replace(/^\//, '')}`;
  }

  async getGiftCollections(opts?: { includeHidden?: boolean }): Promise<TelegramGiftCatalogRow[]> {
    const includeHidden = opts?.includeHidden === true;
    const now = Date.now();
    if (this.collectionsCache && now - this.collectionsCache.at < this.ttlMs) {
      return this.filterCatalog(this.collectionsCache.data, includeHidden);
    }

    const url = `${this.apiBase()}/gifts/collections`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`MRKT catalog GET ${res.status}: ${text.slice(0, 160)}`);
      throw new Error(`mrkt_catalog_http_${res.status}`);
    }

    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) {
      throw new Error('mrkt_catalog_invalid_shape');
    }

    const seen = new Set<string>();
    const rows: TelegramGiftCatalogRow[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title.trim() : '';
      const name = typeof o.name === 'string' ? o.name.trim() : '';
      const canonicalTitle = title || name;
      if (!canonicalTitle) continue;

      const collectionId = pickCatalogId(o) ?? undefined;

      const dedupeKey = canonicalTitle.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const thumb =
        typeof o.modelStickerThumbnailKey === 'string' ? o.modelStickerThumbnailKey.trim() : '';
      rows.push({
        collectionTitle: canonicalTitle,
        collectionName: name || title || undefined,
        collectionId,
        stickerUrl: thumb ? this.stickerUrl(thumb) : null,
        isHidden: o.isHidden === true,
      });
    }

    rows.sort((a, b) => a.collectionTitle.localeCompare(b.collectionTitle));
    this.collectionsCache = { at: now, data: rows };
    return this.filterCatalog(rows, includeHidden);
  }

  /**
   * Maps listing payload strings to **canonical** `title` from MRKT's public catalog (same source as the mini app).
   * Uses id match first, then case-insensitive title/name, then Star Gift key equality.
   */
  async resolveCanonicalCollectionDisplay(
    listing: Pick<ExternalListing, 'collection' | 'collection_display' | 'collection_slug'> & {
      gifts_collection_id?: string | null;
    },
  ): Promise<string | null> {
    try {
      const rows = await this.getGiftCollections({ includeHidden: true });
      const gid = listing.gifts_collection_id?.trim();
      if (gid) {
        const byId = rows.find((r) => r.collectionId === gid);
        if (byId) return byId.collectionTitle;
      }

      const candidates: string[] = [];
      const push = (s: string | undefined | null) => {
        const t = s?.trim();
        if (t) candidates.push(t);
      };
      push(listing.collection_display);
      push(listing.collection);
      if (listing.collection_slug?.trim()) {
        push(listing.collection_slug.trim().replace(/-/g, ' '));
      }

      if (candidates.length === 0) return null;

      const lowered = new Set(candidates.map((c) => c.toLowerCase()));

      for (const r of rows) {
        if (lowered.has(r.collectionTitle.toLowerCase())) return r.collectionTitle;
        const nm = r.collectionName?.trim();
        if (nm && lowered.has(nm.toLowerCase())) return r.collectionTitle;
      }

      const candidateKeys = candidates.map((c) => starGiftSlugKeyFromMrktTitle(c)).filter(Boolean);
      for (const r of rows) {
        const rk = starGiftSlugKeyFromMrktTitle(r.collectionTitle);
        if (candidateKeys.some((ck) => ck === rk)) return r.collectionTitle;
        const rn = r.collectionName ? starGiftSlugKeyFromMrktTitle(r.collectionName) : '';
        if (rn && candidateKeys.some((ck) => ck === rn)) return r.collectionTitle;
      }

      return null;
    } catch (err) {
      this.logger.debug(`resolveCanonicalCollectionDisplay: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private filterCatalog(rows: TelegramGiftCatalogRow[], includeHidden: boolean): TelegramGiftCatalogRow[] {
    if (includeHidden) return rows;
    return rows.filter((r) => !r.isHidden);
  }

  async getModelsForCollection(collectionTitle: string): Promise<TelegramGiftModelRow[]> {
    const coll = collectionTitle.trim();
    if (!coll) return [];

    const now = Date.now();
    const ck = coll.toLowerCase();
    const cached = this.modelsCache.get(ck);
    if (cached && now - cached.at < this.ttlMs) {
      return cached.data;
    }

    const url = `${this.apiBase()}/gifts/models`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ Collections: [coll] }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`MRKT models POST ${res.status}: ${text.slice(0, 160)}`);
      throw new Error(`mrkt_models_http_${res.status}`);
    }

    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) {
      throw new Error('mrkt_models_invalid_shape');
    }

    const out: TelegramGiftModelRow[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const modelName = typeof o.modelName === 'string' ? o.modelName.trim() : '';
      if (!modelName) continue;
      const pm =
        typeof o.rarityPerMille === 'number' && Number.isFinite(o.rarityPerMille)
          ? o.rarityPerMille
          : null;
      const rarityPercent = pm != null ? Number((pm / 10).toFixed(2)) : null;
      const thumb =
        typeof o.modelStickerThumbnailKey === 'string' ? o.modelStickerThumbnailKey.trim() : '';
      out.push({
        modelName,
        rarityPercent,
        stickerUrl: thumb ? this.stickerUrl(thumb) : null,
      });
    }

    out.sort((a, b) => a.modelName.localeCompare(b.modelName));
    this.modelsCache.set(ck, { at: now, data: out });
    return out;
  }
}

function pickCatalogId(o: Record<string, unknown>): string | null {
  for (const k of ['id', 'Id', 'giftsCollectionId', 'gifts_collection_id', 'collectionId', 'collection_id']) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}
