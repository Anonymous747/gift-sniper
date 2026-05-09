import { createHmac } from 'crypto';

/**
 * Validates Telegram Mini App `initData` per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramWebAppInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
): { ok: true; userId?: string } | { ok: false; reason: string } {
  if (!initData || !botToken) return { ok: false, reason: 'missing_input' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing_hash' };
  const authDateRaw = params.get('auth_date');
  const authDate = authDateRaw != null ? parseInt(authDateRaw, 10) : NaN;
  if (!Number.isFinite(authDate)) return { ok: false, reason: 'bad_auth_date' };
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age > maxAgeSec || age < -120) return { ok: false, reason: 'stale_auth' };

  const pairs: [string, string][] = [];
  for (const [k, v] of params.entries()) {
    if (k === 'hash') continue;
    pairs.push([k, v]);
  }
  pairs.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computed !== hash) return { ok: false, reason: 'bad_hash' };

  let userId: string | undefined;
  const userJson = params.get('user');
  if (userJson) {
    try {
      const u = JSON.parse(userJson) as { id?: number };
      if (typeof u.id === 'number') userId = String(u.id);
    } catch {
      /* ignore */
    }
  }
  return { ok: true, userId };
}
