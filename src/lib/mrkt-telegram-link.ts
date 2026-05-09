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

/**
 * Opens the gift inside Telegram MRKT Mini App — same pattern as `startapp=sakura-8957`
 * @see https://t.me/mrkt/app?startapp=sakura-8957
 *
 * When `serial_number` is set, MRKT expects the human slug `{collection}-{serial}`; otherwise
 * fall back to API `gift_id` (e.g. opaque id).
 */
export function mrktTelegramGiftUrl(
  event: Pick<NormalizedMarketEvent, 'market' | 'gift_id' | 'collection' | 'serial_number'>,
): string | null {
  if (event.market !== 'mrkt' || !event.gift_id) return null;
  const startapp =
    event.serial_number != null
      ? `${slugifyCollectionName(event.collection)}-${event.serial_number}`
      : event.gift_id;
  return `https://t.me/mrkt/app?startapp=${encodeURIComponent(startapp)}`;
}
