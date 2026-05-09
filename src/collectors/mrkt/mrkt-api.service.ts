import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mapMrktGiftToExternalListing, parseSalingGiftsPayload } from './mrkt-gift-mapper';
import type { ExternalListing } from './mrkt.types';

const DEFAULT_SALING_BODY: Record<string, unknown> = {
  collectionNames: [],
  modelNames: [],
  backdropNames: [],
  symbolNames: [],
  ordering: 'Price',
  lowToHigh: true,
  maxPrice: null,
  minPrice: null,
  mintable: null,
  number: null,
  count: 20,
  cursor: '',
  query: null,
  promotedFirst: false,
};

@Injectable()
export class MrktApiService {
  private readonly logger = new Logger(MrktApiService.name);
  private readonly baseUrl: string;
  private readonly staticToken?: string;
  private readonly initData?: string;
  private readonly maxPages: number;
  private cachedToken: string | null = null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      this.config.get<string>('MRKT_API_BASE') ?? 'https://api.tgmrkt.io/api/v1'
    ).replace(/\/$/, '');
    this.staticToken = this.config.get<string>('MRKT_TOKEN')?.trim() || undefined;
    this.initData = this.config.get<string>('MRKT_INIT_DATA')?.trim() || undefined;
    this.maxPages = this.config.get<number>('MRKT_SALING_MAX_PAGES') ?? 3;
  }

  isConfigured(): boolean {
    return Boolean(this.staticToken || this.initData);
  }

  async fetchSaleListings(): Promise<ExternalListing[]> {
    const token = await this.resolveToken();
    if (!token) {
      this.logger.warn('MRKT: missing MRKT_TOKEN and MRKT_INIT_DATA; cannot call API');
      return [];
    }

    const bodyBase = this.mergeSalingBody();
    const headers = this.buildHeaders(token);
    const out: ExternalListing[] = [];
    let cursor = '';
    for (let page = 0; page < this.maxPages; page++) {
      const body = { ...bodyBase, cursor };
      const res = await fetch(`${this.baseUrl}/gifts/saling`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (res.status === 401) {
        this.cachedToken = null;
        this.logger.warn('MRKT: 401 on saling; token cleared. Set fresh MRKT_TOKEN or MRKT_INIT_DATA.');
        return out;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`MRKT saling HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const json = (await res.json()) as Record<string, unknown>;
      const rawGifts = parseSalingGiftsPayload(json);
      for (const g of rawGifts) {
        const row = mapMrktGiftToExternalListing(g);
        if (row) out.push(row);
      }

      const next = json.cursor ?? json.Cursor;
      if (typeof next !== 'string' || next.length === 0) break;
      if (rawGifts.length === 0) break;
      cursor = next;
    }

    return out;
  }

  private mergeSalingBody(): Record<string, unknown> {
    const raw = this.config.get<string>('MRKT_SALING_JSON');
    if (!raw?.trim()) return { ...DEFAULT_SALING_BODY };
    try {
      const extra = JSON.parse(raw) as Record<string, unknown>;
      return { ...DEFAULT_SALING_BODY, ...extra };
    } catch {
      this.logger.warn('MRKT_SALING_JSON is invalid JSON; using defaults');
      return { ...DEFAULT_SALING_BODY };
    }
  }

  private buildHeaders(token: string): Record<string, string> {
    const ua =
      this.config.get<string>('MRKT_USER_AGENT') ??
      'Mozilla/5.0 (compatible; gift-sniper/0.1; +https://github.com/)';
    return {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      Origin: 'https://cdn.tgmrkt.io',
      Referer: 'https://cdn.tgmrkt.io/',
      Authorization: token,
      Cookie: `access_token=${token}`,
      'User-Agent': ua,
    };
  }

  private async resolveToken(): Promise<string | null> {
    if (this.staticToken) return this.staticToken;
    if (this.cachedToken) return this.cachedToken;
    if (!this.initData) return null;

    const res = await fetch(`${this.baseUrl}/auth`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: 'https://cdn.tgmrkt.io',
        Referer: 'https://cdn.tgmrkt.io/',
        'User-Agent':
          this.config.get<string>('MRKT_USER_AGENT') ??
          'Mozilla/5.0 (compatible; gift-sniper/0.1; +https://github.com/)',
      },
      body: JSON.stringify({ data: this.initData }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`MRKT auth failed HTTP ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const data = (await res.json()) as { token?: string };
    const token = data.token?.trim();
    if (!token) {
      this.logger.warn('MRKT auth response missing token');
      return null;
    }
    this.cachedToken = token;
    return token;
  }
}
