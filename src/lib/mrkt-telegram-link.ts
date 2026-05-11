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
 * MRKT catalog `title` / `name` → Telegram Star Gift key (e.g. Chill Flame → ChillFlame).
 * Used to validate `nftTelegramSuffix` keys against `/gifts/collections`.
 */
export function starGiftSlugKeyFromMrktTitle(title: string): string {
  return title
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => word.split('-').filter(Boolean))
    .map(normalizeNftSlugRun)
    .join('');
}

/** Key segment before `-{serial}` in a normalized path like `ChillFlame-70357`. */
export function telegramStarGiftKeyFromPathSegment(segment: string): string | null {
  const m = segment.trim().match(/^(.+)-(\d+)$/);
  return m?.[1] != null ? m[1] : null;
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

/** Parses `nft_telegram_suffix` → normalized `Key-serial` when shape + serial match (any market). */
function parseListingNftSuffixSegment(event: NftLinkEvent): string | null {
  const suffixRaw = event.nft_telegram_suffix?.trim();
  if (!suffixRaw) return null;
  const parsed = parseNftTelegramSuffix(suffixRaw);
  if (!parsed || !nftSuffixSerialMatchesSegment(parsed, event.serial_number)) return null;
  return parsed;
}

/** Parses MRKT telegram suffix → normalized `Key-serial`; MRKT-only wrapper for legacy callers. */
export function parseMrktNftTelegramPathSegment(event: NftLinkEvent): string | null {
  if (event.market !== 'mrkt') return null;
  return parseListingNftSuffixSegment(event);
}

/** Telegram Star Gift key derived from MRKT naming for **this listing** (`collection_display` preferred). */
export function listingTelegramStarGiftKey(event: NftLinkEvent): string {
  const display = event.collection_display?.trim();
  const collection = event.collection?.trim();
  const slug = event.collection_slug?.trim();
  const fromDisplay = display ? starGiftSlugKeyFromMrktTitle(display) : '';
  if (fromDisplay) return fromDisplay;
  const fromCollection = collection ? starGiftSlugKeyFromMrktTitle(collection) : '';
  if (fromCollection && fromCollection.toLowerCase() !== 'unknown') return fromCollection;
  if (slug) return starGiftSlugKeyFromMrktTitle(slug);
  return '';
}

/**
 * `https://t.me/nft/…` when `nft_telegram_suffix` parses and key matches listing series
 * (blocks bogus `Neon-*` vs `NeonSign-*`). Any market with that field.
 */
export function collectibleNftUrlFromValidatedSuffix(event: NftLinkEvent): string | null {
  const seg = parseListingNftSuffixSegment(event);
  if (!seg) return null;
  const suffixKey = telegramStarGiftKeyFromPathSegment(seg);
  const listingKey = listingTelegramStarGiftKey(event);
  if (!suffixKey || !listingKey || suffixKey !== listingKey) return null;
  return `https://t.me/nft/${seg}`;
}

/**
 * `https://t.me/nft/…` only when MRKT suffix parses and gift key matches listing series (MRKT-only export).
 */
export function mrktValidatedCollectibleNftUrl(event: NftLinkEvent): string | null {
  if (event.market !== 'mrkt') return null;
  return collectibleNftUrlFromValidatedSuffix(event);
}

/**
 * Derives collectible URL when API omits `nftTelegramSuffix` but `gift_id` is `{slug}-{serial}` and the slug
 * resolves to the same Star Gift key as `collection` / `collection_display` (same safety as suffix match).
 */
export function deriveCollectibleNftUrlFromGiftId(event: NftLinkEvent): string | null {
  if (event.market !== 'mrkt' && event.market !== 'portals' && event.market !== 'tonnel') return null;
  if (event.serial_number == null || !Number.isFinite(event.serial_number)) return null;
  const listingKey = listingTelegramStarGiftKey(event);
  if (!listingKey) return null;

  const gid = event.gift_id?.trim();
  if (!gid || !MRKT_SLUG_SERIAL_ID.test(gid)) return null;
  const m = gid.match(MRKT_SLUG_SERIAL_ID)!;
  const serial = Number(m[2]);
  if (serial !== event.serial_number) return null;

  const slugHyphen = m[1];
  const keyFromGiftId = starGiftSlugKeyFromMrktTitle(slugHyphen.replace(/-/g, ' '));
  if (!keyFromGiftId || keyFromGiftId !== listingKey) return null;

  const segment = normalizeTelegramNftPathSegment(`${listingKey}-${event.serial_number}`);
  if (!NFT_PATH_SEGMENT.test(segment)) return null;
  return `https://t.me/nft/${segment}`;
}

/**
 * NFT card URL: validated suffix first; if API sent a non-empty suffix that failed validation, do not guess.
 * Otherwise derive from `gift_id` + listing key when possible (MRKT / Portals / Tonnel slug-serial ids).
 */
export function telegramCollectibleNftUrlBestEffort(event: NftLinkEvent): string | null {
  const strict = collectibleNftUrlFromValidatedSuffix(event);
  if (strict) return strict;
  if (event.nft_telegram_suffix?.trim()) return null;
  return deriveCollectibleNftUrlFromGiftId(event);
}

/** Single “best” showcase URL: NFT (suffix or derived) if any, else MRKT mini-app. */
export function mrktPrimaryListingDisplayUrl(event: NftLinkEvent): string | null {
  if (event.market !== 'mrkt') return null;
  return telegramCollectibleNftUrlBestEffort(event) ?? mrktTelegramGiftUrl(event as MrktLinkEvent);
}

/**
 * Portals deep link (`gift_id` is the `startapp` payload from listing feeds).
 * @see https://t.me/portals/market?startapp=…
 */
export function portalsMarketListingUrl(event: Pick<NormalizedMarketEvent, 'market' | 'gift_id'>): string | null {
  if (event.market !== 'portals' || !event.gift_id?.trim()) return null;
  return `https://t.me/portals/market?startapp=${encodeURIComponent(event.gift_id.trim())}`;
}

export function telegramNftCollectibleUrl(event: NftLinkEvent): string | null {
  return telegramCollectibleNftUrlBestEffort(event);
}

/**
 * Telegram MRKT Mini App URL (`startapp` opens the gift in @mrkt).
 * @see https://t.me/mrkt/app?startapp=neon-6709
 */
export function mrktTelegramGiftUrl(event: MrktLinkEvent): string | null {
  if (event.market !== 'mrkt' || !event.gift_id) return null;

  const gid = event.gift_id.trim();
  let startapp: string;

  // MRKT often uses opaque numeric internal ids (`startapp=363826839`); prefer as-is vs inventing slug-serial.
  if (/^\d+$/.test(gid)) {
    startapp = gid;
  } else if (MRKT_SLUG_SERIAL_ID.test(gid)) {
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

/**
 * Sync URL without per-listing resolver. For **MRKT** always returns the mini-app link unless callers use
 * `mrktPrimaryListingDisplayUrl` (alerts/intel paths).
 */
export function giftTelegramDisplayUrl(event: NftLinkEvent): string | null {
  if (event.market === 'mrkt') {
    return mrktTelegramGiftUrl(event as MrktLinkEvent);
  }
  if (event.market === 'portals') {
    return portalsMarketListingUrl(event);
  }
  return telegramCollectibleNftUrlBestEffort(event) ?? mrktTelegramGiftUrl(event as MrktLinkEvent);
}
