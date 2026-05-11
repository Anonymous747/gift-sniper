import type { NormalizedMarketEvent } from '../events/normalized-event';
import {
  giftTelegramDisplayUrl,
  mrktPrimaryListingDisplayUrl,
  mrktTelegramGiftUrl,
  mrktValidatedCollectibleNftUrl,
} from './mrkt-telegram-link';

export type ListingCardLocale = 'ru' | 'en';

export type FormatGiftListingCardOpts = {
  headline: string;
  subhead?: string | null;
  /** When set (positive finite), append ` (~$…)` to the TON price. */
  tonUsdRate?: number | null;
  sniperScore?: number | null;
  locale?: ListingCardLocale;
};

function tonDisplay(ton: number | null | undefined): string {
  if (ton == null || !Number.isFinite(ton)) return 'n/a';
  return ton.toFixed(1);
}

function nzLabel(value: string | null | undefined): string {
  const t = value?.trim();
  return t && t.length > 0 ? t : 'n/a';
}

function txt(locale: ListingCardLocale, ru: string, en: string): string {
  return locale === 'ru' ? ru : en;
}

function priceSuffixTonUsd(ton: number | null | undefined, rate: number | null | undefined): string {
  if (ton == null || !Number.isFinite(ton)) return '';
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return '';
  return ` (~$${(ton * rate).toFixed(1)})`;
}

function buildMrktOpeningLine(event: NormalizedMarketEvent, locale: ListingCardLocale, tonUsd: string): string {
  const name = event.gift_name.trim();
  const nft = mrktValidatedCollectibleNftUrl(event);
  const app = mrktTelegramGiftUrl(event);
  const price = `${tonDisplay(event.price_ton)} TON${tonUsd}`;

  const nameLinked = nft != null ? `${name} (${nft})` : name;
  const mrktParen = app != null ? ` (${app})` : '';

  if (locale === 'ru') {
    return `${nameLinked} на MRKT${mrktParen} за ${price}`;
  }
  return `${nameLinked} on MRKT${mrktParen} for ${price}`;
}

function buildGenericOpeningLine(event: NormalizedMarketEvent, locale: ListingCardLocale, tonUsd: string): string {
  const name = event.gift_name.trim();
  const url = giftTelegramDisplayUrl(event);
  const nameLinked = url != null ? `${name} (${url})` : name;
  const price = `${tonDisplay(event.price_ton)} TON${tonUsd}`;
  const venue = event.market.toUpperCase();
  if (locale === 'ru') {
    return `${nameLinked} на ${venue} за ${price}`;
  }
  return `${nameLinked} on ${venue} for ${price}`;
}

/**
 * Telegram listing card modeled after `@market_alerts_robot`-style MRKT alerts (dual floors,
 * NFT + mini-app on the headline when valid, placeholders for APIs we do not ingest yet).
 */
export function formatGiftListingTelegramCard(
  event: NormalizedMarketEvent,
  opts: FormatGiftListingCardOpts,
): string {
  const locale: ListingCardLocale = opts.locale ?? 'en';
  const tonUsd = priceSuffixTonUsd(event.price_ton, opts.tonUsdRate);
  const opening =
    event.market === 'mrkt'
      ? buildMrktOpeningLine(event, locale, tonUsd)
      : buildGenericOpeningLine(event, locale, tonUsd);

  const floorGiftLabel = txt(locale, 'Флор гифта', 'Gift-series floor');
  const floorModelLabel = txt(locale, 'Флор модели', 'Model / backdrop floor');
  const floorGift = tonDisplay(event.floor_price_collection ?? event.floor_price);
  const floorModel = tonDisplay(event.floor_price_backdrop_model ?? null);

  const sn = opts.sniperScore;
  const sniperLine =
    sn != null && Number.isFinite(sn)
      ? txt(locale, `Снайпер: ${sn.toFixed(2)}`, `Sniper: ${sn.toFixed(2)}`)
      : txt(locale, 'Снайпер: n/a', 'Sniper: n/a');

  const below =
    event.below_floor_percent != null && Number.isFinite(event.below_floor_percent)
      ? `${event.below_floor_percent.toFixed(1)}%`
      : 'n/a';
  const discountLine =
    locale === 'ru' ? `Скидка к флору: ${below}` : `Discount vs floor baseline: ${below}`;

  const rank =
    event.rarity_rank != null && Number.isFinite(event.rarity_rank)
      ? `#${event.rarity_rank}`
      : 'n/a';
  const rankLine =
    locale === 'ru'
      ? `Ранг по редкости: ${rank}`
      : `Rarity rank: ${rank}`;

  /** MRKT tap-through: keep mini-app listing link even when the collectible NFT URL is primary elsewhere. */
  const listingTap =
    event.market === 'mrkt'
      ? mrktTelegramGiftUrl(event)
      : giftTelegramDisplayUrl(event) ?? mrktPrimaryListingDisplayUrl(event);
  const linkLine =
    listingTap != null
      ? `${txt(locale, 'Ссылка', 'Link')} (${listingTap})`
      : `${txt(locale, 'Ссылка', 'Link')}: n/a`;

  const seriesLabel = nzLabel(event.collection_display?.trim() || event.collection?.trim());

  const lines: string[] = [];
  lines.push(opts.headline.trim());
  const sub = opts.subhead?.trim();
  if (sub) lines.push(sub);
  lines.push('', opening);

  lines.push(txt(locale, 'Модель', 'Model') + `: ${nzLabel(event.gift_model)}`);
  lines.push(txt(locale, 'Узор', 'Pattern / symbol') + `: ${nzLabel(event.gift_symbol)}`);
  lines.push(txt(locale, 'Фон', 'Backdrop') + `: ${nzLabel(event.gift_backdrop)}`);
  lines.push(txt(locale, 'Серия гифта', 'Gift series') + `: ${seriesLabel}`);

  lines.push('', txt(locale, 'Последние владельцы:', 'Recent holders:'));
  lines.push(txt(locale,
    '— пока недоступно в потоке листингов MRKT',
    '— not available in MRKT listing feed (ownership history APIs not wired yet)',
  ));

  lines.push('', `${floorGiftLabel}: ${floorGift} TON`);
  lines.push(`${floorModelLabel}: ${floorModel} TON`);
  lines.push('', discountLine, rankLine, sniperLine);

  lines.push('', txt(locale, 'Последние продажи модели:', 'Recent sales (same model / backdrop):'));
  lines.push(txt(locale,
    '— нужен отдельный агрегат (Portals / MRKT closes); здесь только листинг',
    '— needs Portals/MRKT sales aggregate; listing feed only carries ask data',
  ));

  lines.push('', linkLine);

  return lines.join('\n');
}
