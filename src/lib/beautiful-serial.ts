/**
 * “Beautiful number” heuristics for gift serials — engagement + sniper bonus.
 * Rules: repeating digits, runs, palindromes, low IDs, meme numbers.
 */

const MEME = new Set([69, 420, 1337, 8008, 80085]);

function allSameDigit(n: number): boolean {
  const s = String(Math.abs(Math.trunc(n)));
  if (s.length < 2) return false;
  return s.split('').every((c) => c === s[0]);
}

function hasStrictlyAscendingRun(s: string, minLen: number): boolean {
  for (let i = 0; i <= s.length - minLen; i++) {
    let ok = true;
    for (let j = 1; j < minLen; j++) {
      const a = s.charCodeAt(i + j - 1);
      const b = s.charCodeAt(i + j);
      if (b !== a + 1) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function hasStrictlyDescendingRun(s: string, minLen: number): boolean {
  for (let i = 0; i <= s.length - minLen; i++) {
    let ok = true;
    for (let j = 1; j < minLen; j++) {
      const a = s.charCodeAt(i + j - 1);
      const b = s.charCodeAt(i + j);
      if (b !== a - 1) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function isPalindrome(n: number): boolean {
  const s = String(Math.abs(Math.trunc(n)));
  return s.length >= 2 && s === s.split('').reverse().join('');
}

export type SerialAnalysis = {
  /** Added into sniper score (0–20+). */
  bonus: number;
  /** Worth a separate “viral” Telegram line / optional second alert. */
  viral: boolean;
  /** Short human-readable tag for logs / alerts. */
  label: string | null;
};

/**
 * Score + label serial patterns collectors care about (low friction, high recall).
 */
export function analyzeSerial(serial: number | null): SerialAnalysis {
  if (serial == null || !Number.isFinite(serial)) {
    return { bonus: 0, viral: false, label: null };
  }
  const n = Math.trunc(serial);
  const s = String(Math.abs(n));
  const reasons: string[] = [];
  let bonus = 0;
  let viral = false;

  if (MEME.has(n)) {
    reasons.push('meme');
    bonus += 6;
    viral = true;
  }
  if (n > 0 && n < 100) {
    reasons.push('low_id');
    bonus += 5;
    viral = true;
  }
  if (allSameDigit(n) && s.length >= 3) {
    reasons.push('repeating');
    bonus += 7;
    viral = true;
  } else if (allSameDigit(n) && s.length === 2) {
    reasons.push('double');
    bonus += 3;
  }
  if (isPalindrome(n) && s.length >= 4) {
    reasons.push('palindrome');
    bonus += 5;
    viral = true;
  } else if (isPalindrome(n) && s.length >= 2) {
    reasons.push('palindrome');
    bonus += 2;
  }
  if (s.length >= 4 && (hasStrictlyAscendingRun(s, 4) || hasStrictlyDescendingRun(s, 4))) {
    reasons.push('run');
    bonus += 5;
    viral = true;
  } else if (s.length >= 3 && (hasStrictlyAscendingRun(s, 3) || hasStrictlyDescendingRun(s, 3))) {
    reasons.push('run3');
    bonus += 3;
  }

  const label = reasons.length ? reasons.join('+') : null;
  return { bonus: Math.min(22, bonus), viral, label };
}
