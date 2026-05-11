import type { ExternalListing } from './mrkt.types';

const NANO = 1_000_000_000;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** MRKT sometimes nests the payload under `gift` / `Gift`. Top-level keys win on conflict. */
function mergedGiftRow(raw: Record<string, unknown>): Record<string, unknown> {
  const inner = asRecord(raw.gift) ?? asRecord(raw.Gift);
  if (!inner) return raw;
  return { ...inner, ...raw };
}

/** String from a primitive, or from common nested shapes `{ name, title, … }`. */
function strFromUnknown(v: unknown): string {
  if (typeof v === 'string' && v.trim()) return v.trim();
  const o = asRecord(v);
  if (!o) return '';
  for (const k of ['name', 'Name', 'title', 'Title', 'value', 'displayName', 'label', 'slug', 'Slug']) {
    const t = o[k];
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  return '';
}

function pickStr(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

function pickStrLoose(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const s = strFromUnknown(o[k]);
    if (s) return s;
  }
  return '';
}

function pickTrait(o: Record<string, unknown>, ...keys: string[]): string | null {
  const s = pickStrLoose(o, ...keys);
  return s.length > 0 ? s : null;
}

function pickNum(o: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function nanoToTon(n: number | null): number | null {
  if (n == null) return null;
  return n / NANO;
}

/**
 * Maps a single MRKT `/gifts/saling` gift object (camelCase per tgmrkt API) to our collector row.
 */
export function mapMrktGiftToExternalListing(raw: Record<string, unknown>): ExternalListing | null {
  const row = mergedGiftRow(raw);
  const id = pickStr(row, 'id', 'Id');
  if (!id) return null;

  const saleNano = pickNum(row, 'salePrice', 'sale_price');
  if (saleNano == null) return null;
  const priceTon = saleNano / NANO;
  if (!Number.isFinite(priceTon) || priceTon <= 0) return null;

  const collection = pickStr(row, 'collectionName', 'collection_name') || 'Unknown';
  const collectionSlug =
    pickStr(row, 'collectionSlug', 'collection_slug') || undefined;
  const nftSuffixRaw = pickStrLoose(
    row,
    'nftTelegramSuffix',
    'nft_telegram_suffix',
    'telegramNftSuffix',
    'telegram_nft_suffix',
    'telegramGiftName',
    'telegram_gift_name',
    'telegramNft',
    'telegram_nft',
    'nftSlug',
    'nft_slug',
    'nftPath',
    'nft_path',
    'telegramCollectibleSlug',
    'telegram_collectible_slug',
    'starGiftSlug',
    'star_gift_slug',
    'stargiftSlug',
    'stargift_slug',
  );
  const number = pickNum(row, 'number', 'Number');
  const title = pickStr(row, 'title', 'Title', 'name', 'Name');
  const giftName =
    title ||
    (number != null ? `${collection} #${number}` : `${collection} · ${id.slice(0, 8)}`);
  const giftModel =
    pickTrait(
      row,
      'modelName',
      'model_name',
      'ModelName',
      'model',
      'Model',
      'giftModel',
      'gift_model',
      'visualModel',
      'visual_model',
    ) ?? null;
  const giftBackdrop =
    pickTrait(
      row,
      'backdropName',
      'backdrop_name',
      'BackdropName',
      'backdrop',
      'Backdrop',
      'giftBackdrop',
      'gift_backdrop',
      'backgroundName',
      'background_name',
    ) ?? null;
  const giftSymbol =
    pickTrait(
      row,
      'symbolName',
      'symbol_name',
      'SymbolName',
      'symbol',
      'Symbol',
      'giftSymbol',
      'gift_symbol',
    ) ?? null;

  const floorNano =
    pickNum(row, 'floorPriceNanoTONsByCollection', 'floorPriceNanoTONsByBackdropModel') ??
    pickNum(row, 'floorPriceNanoTonsByCollection', 'floorPriceNanoTonsByBackdropModel');
  const floorTon = floorNano != null ? nanoToTon(floorNano) : null;

  const modelPm = pickNum(row, 'modelRarityPerMille', 'model_rarity_per_mille');
  const backdropPm = pickNum(row, 'backdropRarityPerMille', 'backdrop_rarity_per_mille');
  const symbolPm = pickNum(row, 'symbolRarityPerMille', 'symbol_rarity_per_mille');
  const rarityScore =
    modelPm != null || backdropPm != null || symbolPm != null
      ? Number(
          (
            ((modelPm ?? 0) + (backdropPm ?? 0) + (symbolPm ?? 0)) /
            3 /
            1000
          ).toFixed(4),
        )
      : null;

  return {
    gift_id: id,
    collection,
    collection_slug: collectionSlug,
    nft_telegram_suffix: nftSuffixRaw || undefined,
    collection_display: pickStr(row, 'collectionTitle', 'collection_title') || undefined,
    gift_name: giftName,
    gift_model: giftModel || undefined,
    gift_backdrop: giftBackdrop || undefined,
    gift_symbol: giftSymbol || undefined,
    serial_number: number,
    price_ton: Number(priceTon.toFixed(4)),
    floor_price: floorTon != null ? Number(floorTon.toFixed(4)) : null,
    seller_id: null,
    seller_name: null,
    rarity_rank: null,
    rarity_score: rarityScore,
  };
}

export function parseSalingGiftsPayload(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object') return [];
  const o = body as Record<string, unknown>;
  const gifts = o.gifts ?? o.Gifts ?? o.items;
  if (!Array.isArray(gifts)) return [];
  return gifts.filter((g) => g && typeof g === 'object') as Record<string, unknown>[];
}
