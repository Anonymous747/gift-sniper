import type { ExternalListing } from './mrkt.types';

const NANO = 1_000_000_000;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * MRKT often returns `{ …listing fields…, gift: { …full collectible… } }`. Spreading `…raw` alone can
 * leave `model` / `backdrop` / `symbol` as `null` on the wrapper while the nested gift still has traits.
 */
function mergedGiftRow(raw: Record<string, unknown>): Record<string, unknown> {
  const inner = asRecord(raw.gift) ?? asRecord(raw.Gift);
  if (!inner) return raw;

  const merged: Record<string, unknown> = { ...inner, ...raw };

  for (const [k, innerVal] of Object.entries(inner)) {
    if (k === 'gift' || k === 'Gift') continue;
    const mergedVal = merged[k];
    const emptyMerged =
      mergedVal === undefined ||
      mergedVal === null ||
      (typeof mergedVal === 'string' && mergedVal.trim() === '');
    const innerHas =
      innerVal !== undefined &&
      innerVal !== null &&
      !(typeof innerVal === 'string' && innerVal.trim() === '');
    if (emptyMerged && innerHas) merged[k] = innerVal;
  }

  delete merged.gift;
  delete merged.Gift;
  return merged;
}

/** String from a primitive, or from common nested shapes `{ name, title, … }`. */
function strFromUnknown(v: unknown): string {
  if (typeof v === 'string' && v.trim()) return v.trim();
  const o = asRecord(v);
  if (!o) return '';
  for (const k of [
    'name',
    'Name',
    'title',
    'Title',
    'value',
    'Value',
    'displayName',
    'displayTitle',
    'label',
    'slug',
    'Slug',
    'localizedName',
  ]) {
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

/** MRKT often nests traits under `model` / `backdrop` / `symbol` objects (see amrkt `Gift` schema). */
function pickTraitFromParents(
  row: Record<string, unknown>,
  parentKeys: string[],
  ...traitKeys: string[]
): string | null {
  for (const pk of parentKeys) {
    const inner = asRecord(row[pk]);
    if (!inner) continue;
    const t = pickTrait(inner, ...traitKeys);
    if (t) return t;
  }
  return null;
}

function pickFromNestedNumber(
  row: Record<string, unknown>,
  parentKeys: string[],
  ...numKeys: string[]
): number | null {
  for (const pk of parentKeys) {
    const inner = asRecord(row[pk]);
    if (!inner) continue;
    const n = pickNum(inner, ...numKeys);
    if (n != null) return n;
  }
  return null;
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

/** Extra trait tuples some MRKT payloads put on `gift` or the listing envelope. */
function traitsFromTuples(row: Record<string, unknown>): {
  model: string | null;
  backdrop: string | null;
  symbol: string | null;
} {
  let model: string | null = null;
  let backdrop: string | null = null;
  let symbol: string | null = null;

  const arrayKeys = [
    'traits',
    'Traits',
    'giftTraits',
    'GiftTraits',
    'propertyValues',
    'PropertyValues',
    'extendedTraits',
    'attributes',
    'Attributes',
  ];

  for (const ak of arrayKeys) {
    const v = row[ak];
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      const o = asRecord(item);
      if (!o) continue;
      const labelRaw =
        pickStr(o, 'traitType', 'TraitType', 'type', 'Type', 'name', 'Name', 'key', 'Key', 'kind', 'Kind') ??
        '';
      const label = labelRaw.trim().toLowerCase();
      const val =
        pickStrLoose(
          o,
          'value',
          'Value',
          'title',
          'Title',
          'displayTitle',
          'traitValue',
          'TraitValue',
          'trait_name',
          'traitName',
        ) || '';
      if (!label || !val.trim()) continue;
      if (
        label.includes('model') ||
        label.includes('variant') ||
        label === 'gift model' ||
        label === 'visual model'
      ) {
        model ??= val.trim();
      } else if (label.includes('backdrop') || label.includes('background')) {
        backdrop ??= val.trim();
      } else if (
        label.includes('symbol') ||
        label.includes('pattern') ||
        label.includes('узор')
      ) {
        symbol ??= val.trim();
      }
    }
  }

  return { model, backdrop, symbol };
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

  /** MRKT “collection” = gift series name (filter `collectionNames`), same namespace as Telegram NFT slug. */
  const collection =
    pickStrLoose(row, 'collectionTitle', 'collection_title').trim() ||
    pickStr(row, 'collectionName', 'collection_name').trim() ||
    'Unknown';
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
  const giftName =
    pickStrLoose(row, 'title', 'Title').trim() ||
    pickStrLoose(row, 'name', 'Name').trim() ||
    (number != null ? `${collection} #${number}` : `${collection} · ${id.slice(0, 8)}`);

  const tupleTraits = traitsFromTuples(row);

  /** Flat keys match amrkt / MRKT client surfaces (camelCase + PascalCase + nested blobs). */
  const giftModel =
    pickTrait(
      row,
      'modelTitle',
      'model_title',
      'modelName',
      'model_name',
      'giftModel',
      'gift_model',
      'giftModelTitle',
      'GiftModelTitle',
      'giftModelName',
      'GiftModelName',
      'visualModel',
      'visual_model',
      'visualModelTitle',
      'ModelName',
      'ModelTitle',
      'GiftModelDisplay',
      'model',
      'Model',
    ) ??
    pickTraitFromParents(
      row,
      [
        'model',
        'Model',
        'giftModel',
        'GiftModel',
        'gift_model',
        'visualModel',
        'VisualModel',
        'giftModelDto',
      ],
      'modelName',
      'modelTitle',
      'title',
      'name',
      'displayTitle',
      'ModelName',
      'ModelTitle',
    ) ??
    tupleTraits.model;

  const giftBackdrop =
    pickTrait(
      row,
      'backdropTitle',
      'backdrop_title',
      'backdropName',
      'backdrop_name',
      'BackdropName',
      'BackdropTitle',
      'giftBackdrop',
      'gift_backdrop',
      'giftBackdropName',
      'GiftBackdropName',
      'backdrop',
      'Backdrop',
      'backgroundName',
      'background_name',
      'background',
      'Background',
      'BackgroundName',
    ) ??
    pickTraitFromParents(
      row,
      [
        'backdrop',
        'Backdrop',
        'giftBackdrop',
        'GiftBackdrop',
        'background',
        'Background',
      ],
      'backdropName',
      'backdropTitle',
      'title',
      'name',
      'BackdropName',
      'BackdropTitle',
      'BackgroundName',
    ) ??
    tupleTraits.backdrop;

  const giftSymbol =
    pickTrait(
      row,
      'symbolTitle',
      'symbol_title',
      'symbolName',
      'symbol_name',
      'SymbolName',
      'SymbolTitle',
      'giftSymbol',
      'gift_symbol',
      'giftPattern',
      'patternName',
      'pattern_name',
      'patternTitle',
      'PatternName',
      'PatternTitle',
      'symbol',
      'Symbol',
    ) ??
    pickTraitFromParents(
      row,
      ['symbol', 'Symbol', 'giftSymbol', 'GiftSymbol', 'pattern', 'Pattern', 'giftPattern'],
      'symbolName',
      'symbolTitle',
      'patternName',
      'title',
      'name',
      'SymbolName',
      'PatternName',
    ) ??
    tupleTraits.symbol;

  const floorNanoCollection =
    pickNum(row, 'floorPriceNanoTONsByCollection', 'floorPriceNanoTonsByCollection') ??
    null;
  const floorNanoBackdropModel =
    pickNum(row, 'floorPriceNanoTONsByBackdropModel', 'floorPriceNanoTonsByBackdropModel') ??
    null;

  const floorCollectionTon =
    floorNanoCollection != null ? Number(nanoToTon(floorNanoCollection)!.toFixed(4)) : null;
  const floorBackdropTon =
    floorNanoBackdropModel != null ? Number(nanoToTon(floorNanoBackdropModel)!.toFixed(4)) : null;
  const floorForDiscount = floorCollectionTon ?? floorBackdropTon;

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
    collection_display: pickStrLoose(row, 'collectionTitle', 'collection_title').trim() || undefined,
    gift_name: giftName,
    gift_model: giftModel || undefined,
    gift_backdrop: giftBackdrop || undefined,
    gift_symbol: giftSymbol || undefined,
    serial_number: number,
    price_ton: Number(priceTon.toFixed(4)),
    floor_price_collection: floorCollectionTon,
    floor_price_backdrop_model: floorBackdropTon,
    floor_price: floorForDiscount,
    seller_id: pickStrLoose(row, 'sellerId', 'seller_id').trim() || null,
    seller_name: pickStrLoose(row, 'sellerName', 'seller_name', 'sellerFullName').trim() || null,
    rarity_rank:
      pickNum(
        row,
        'rarityRank',
        'rarity_rank',
        'giftRarityRank',
        'gift_rarity_rank',
        'globalRarityRank',
        'overallRank',
        'overall_rank',
      ) ??
      pickFromNestedNumber(row, ['gift', 'Gift'], 'rarityRank', 'rarity_rank'),
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
