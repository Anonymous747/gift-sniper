import type { NormalizedMarketEvent } from '../events/normalized-event';

/** Lowercase slug for MRKT `startapp` (e.g. `Sakura` → `sakura`, `Lunar Snake` → `lunar-snake`). */
export function slugifyCollectionName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'gift';
}

/** MRKT gift ids / deep-link tokens are usually `{slug}-{serial}` with numeric serial. */
const MRKT_SLUG_SERIAL_ID = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(\d+)$/i;

/** Telegram collectible card path segment: `XmasStocking-219810` — https://t.me/nft/… */
const NFT_PATH_SEGMENT =
  /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*-\d+$/;

type MrktLinkEvent = Pick<
  NormalizedMarketEvent,
  'market' | 'gift_id' | 'collection' | 'serial_number'
> & {
  collection_slug?: string | null;
};

type NftLinkEvent = Pick<
  NormalizedMarketEvent,
  'market' | 'gift_id' | 'collection' | 'serial_number' | 'collection_display'
> & {
  collection_slug?: string | null;
  nft_telegram_suffix?: string | null;
};

function normalizeMrktSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
}

/**
 * One run in a Telegram `t.me/nft/{Key}-{serial}` path (no hyphens in Key).
 * MRKT often sends camelCase (`topHat`) or lowercase (`tophat`); Telegram expects PascalCase (`TopHat`).
 */
function normalizeNftSlugRun(seg: string): string {
  if (!seg) return '';
  // Inner camelCase (e.g. topHat → TopHat); always uppercase first letter for valid collectible URLs.
  if (/[a-z][A-Z]/.test(seg)) {
    return seg.charAt(0).toUpperCase() + seg.slice(1);
  }
  return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase();
}

/**
 * Telegram collectible paths use PascalCase collection keys (`Obsidian-8926`), not MRKT lowercase (`obsidian-8926`).
 * Hyphenated slugs become concatenated runs: `lunar-snake` → `LunarSnake`.
 */
function normalizeTelegramNftPathSegment(full: string): string {
  const m = full.trim().match(/^(.+)-(\d+)$/);
  if (!m) return full.trim();

  const [, slugPart, num] = m;
  const key = slugPart
    .split('-')
    .filter(Boolean)
    .map(normalizeNftSlugRun)
    .join('');

  return `${key}-${num}`;
}

/** When MRKT sends `nftTelegramSuffix` for a different listing, ignore it and derive from gift_id / collection. */
function nftSuffixSerialMatchesSegment(parsedSegment: string, serial: number | null): boolean {
  if (serial == null) return true;
  const m = parsedSegment.match(/-(\d+)$/);
  if (!m) return true;
  return Number(m[1]) === serial;
}

/** Accepts `XmasStocking-219810` or full `https://t.me/nft/XmasStocking-219810`. */
function parseNftTelegramSuffix(raw: string): string | null {
  const t = raw.trim();
  const fromUrl = t.match(/t\.me\/nft\/([^?\s#]+)/i);
  const seg = fromUrl?.[1] != null ? decodeURIComponent(fromUrl[1]) : t;
  if (!NFT_PATH_SEGMENT.test(seg)) return null;
  return normalizeTelegramNftPathSegment(seg);
}

/**
 * When MRKT `gift_id` is `{collectionSlug}-{serial}` and serial matches `serial_number`
 * (when set), build the Telegram collectible path segment (PascalCase key + serial).
 * May still 404 in Telegram if MRKT’s slug does not match Fragment’s canonical id.
 */
function deriveTelegramNftPathFromMrktGiftId(giftId: string, serialNumber: number | null): string | null {
  const gid = giftId.trim();
  const m = gid.match(MRKT_SLUG_SERIAL_ID);
  if (!m) return null;
  const serialFromId = Number(m[2]);
  if (!Number.isFinite(serialFromId)) return null;
  if (serialNumber != null && serialNumber !== serialFromId) return null;
  const normalized = normalizeTelegramNftPathSegment(gid);
  if (!NFT_PATH_SEGMENT.test(normalized)) return null;
  return normalized;
}

/**
 * Telegram collectible gift link (`https://t.me/nft/…`).
 *
 * Order: MRKT `nftTelegramSuffix` (and aliases) when valid; else derive from `gift_id`
 * when it matches `{slug}-{serial}` and serial aligns with `serial_number`.
 */
export function telegramNftCollectibleUrl(event: NftLinkEvent): string | null {
  if (event.market !== 'mrkt' || !event.gift_id?.trim()) return null;

  const suffixRaw = event.nft_telegram_suffix?.trim();
  if (suffixRaw) {
    const parsed = parseNftTelegramSuffix(suffixRaw);
    if (parsed && nftSuffixSerialMatchesSegment(parsed, event.serial_number)) {
      return `https://t.me/nft/${parsed}`;
    }
  }

  const derived = deriveTelegramNftPathFromMrktGiftId(event.gift_id, event.serial_number);
  return derived != null ? `https://t.me/nft/${derived}` : null;
}

/**
 * Telegram MRKT Mini App URL (`startapp` opens the gift in @mrkt).
 * @see https://t.me/mrkt/app?startapp=neon-6709
 */
export function mrktTelegramGiftUrl(event: MrktLinkEvent): string | null {
  if (event.market !== 'mrkt' || !event.gift_id) return null;

  const gid = event.gift_id.trim();
  let startapp: string;

  if (MRKT_SLUG_SERIAL_ID.test(gid)) {
    startapp = gid.toLowerCase();
  } else if (event.serial_number != null) {
    const apiSlug = event.collection_slug?.trim() ? normalizeMrktSlug(event.collection_slug) : '';
    const slug = apiSlug.length > 0 ? apiSlug : slugifyCollectionName(event.collection);
    startapp = `${slug}-${event.serial_number}`;
  } else {
    startapp = gid;
  }

  return `https://t.me/mrkt/app?startapp=${encodeURIComponent(startapp)}`;
}

/** Prefer authoritative Telegram collectible URL; otherwise MRKT mini-app (always valid for MRKT listings). */
export function giftTelegramDisplayUrl(event: NftLinkEvent): string | null {
  return telegramNftCollectibleUrl(event) ?? mrktTelegramGiftUrl(event as MrktLinkEvent);
}
