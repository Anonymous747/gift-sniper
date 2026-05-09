import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_API_BASE = 'https://api.tgmrkt.io/api/v1';
const DEFAULT_CDN_BASE = 'https://cdn.tgmrkt.io';

export type TelegramGiftCatalogRow = {
  /** Value stored in filters / sent to MRKT models API (human collection title). */
  collectionTitle: string;
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
      if (!title) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const thumb =
        typeof o.modelStickerThumbnailKey === 'string' ? o.modelStickerThumbnailKey.trim() : '';
      rows.push({
        collectionTitle: title,
        stickerUrl: thumb ? this.stickerUrl(thumb) : null,
        isHidden: o.isHidden === true,
      });
    }

    rows.sort((a, b) => a.collectionTitle.localeCompare(b.collectionTitle));
    this.collectionsCache = { at: now, data: rows };
    return this.filterCatalog(rows, includeHidden);
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
