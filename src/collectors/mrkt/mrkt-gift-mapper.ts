import type { ExternalListing } from './mrkt.types';

const NANO = 1_000_000_000;

function pickStr(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
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
  const id = pickStr(raw, 'id', 'Id');
  if (!id) return null;

  const saleNano = pickNum(raw, 'salePrice', 'sale_price');
  if (saleNano == null) return null;
  const priceTon = saleNano / NANO;
  if (!Number.isFinite(priceTon) || priceTon <= 0) return null;

  const collection = pickStr(raw, 'collectionName', 'collection_name') || 'Unknown';
  const collectionSlug =
    pickStr(raw, 'collectionSlug', 'collection_slug') || undefined;
  const nftSuffixRaw = pickStr(
    raw,
    'nftTelegramSuffix',
    'nft_telegram_suffix',
    'telegramNftSuffix',
    'telegram_nft_suffix',
    'telegramGiftName',
    'telegram_gift_name',
    'nftSlug',
    'nft_slug',
    'telegramCollectibleSlug',
    'telegram_collectible_slug',
    'starGiftSlug',
    'star_gift_slug',
    'stargiftSlug',
    'stargift_slug',
  );
  const number = pickNum(raw, 'number', 'Number');
  const title = pickStr(raw, 'title', 'Title', 'name', 'Name');
  const giftName =
    title ||
    (number != null ? `${collection} #${number}` : `${collection} · ${id.slice(0, 8)}`);
  const giftModel = pickStr(raw, 'modelName', 'model_name', 'ModelName') || null;
  const giftBackdrop =
    pickStr(raw, 'backdropName', 'backdrop_name', 'BackdropName', 'backgroundName', 'background_name') ||
    null;

  const floorNano =
    pickNum(raw, 'floorPriceNanoTONsByCollection', 'floorPriceNanoTONsByBackdropModel') ??
    pickNum(raw, 'floorPriceNanoTonsByCollection', 'floorPriceNanoTonsByBackdropModel');
  const floorTon = floorNano != null ? nanoToTon(floorNano) : null;

  const modelPm = pickNum(raw, 'modelRarityPerMille', 'model_rarity_per_mille');
  const backdropPm = pickNum(raw, 'backdropRarityPerMille', 'backdrop_rarity_per_mille');
  const symbolPm = pickNum(raw, 'symbolRarityPerMille', 'symbol_rarity_per_mille');
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
    collection_display: pickStr(raw, 'collectionTitle', 'collection_title') || undefined,
    gift_name: giftName,
    gift_model: giftModel || undefined,
    gift_backdrop: giftBackdrop || undefined,
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
