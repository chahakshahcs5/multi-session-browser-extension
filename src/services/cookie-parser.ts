import type { CookieEntry } from '../types';

/**
 * Parse cookie input that can be either JSON or plain text format.
 *
 * JSON format:
 *   [{ "name": "sid", "value": "abc", "domain": ".example.com" }]
 *   or a single object { "name": "sid", "value": "abc" }
 *
 * Text format (one per line or semicolon-separated):
 *   sid=abc123
 *   token=xyz789
 *   -- or --
 *   sid=abc123; token=xyz789
 */
export function parseCookieInput(input: string, hostname: string): CookieEntry[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  // Try JSON first
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return parseJsonCookies(trimmed, hostname);
    } catch {
      // Fall through to text parsing
    }
  }

  return parseTextCookies(trimmed, hostname);
}

/** Parse JSON cookie input */
function parseJsonCookies(input: string, hostname: string): CookieEntry[] {
  const parsed = JSON.parse(input);
  const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

  return items.map((item) => {
    const obj = item as Record<string, unknown>;
    if (!obj.name || !obj.value) {
      throw new Error('Each cookie must have at least "name" and "value"');
    }
    return normaliseCookie(obj, hostname);
  });
}

/** Parse text cookie input: name=value pairs separated by newlines or semicolons */
function parseTextCookies(input: string, hostname: string): CookieEntry[] {
  // Split by newline or semicolons
  const pairs = input
    .split(/[\n;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return pairs.map((pair) => {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) {
      throw new Error(`Invalid cookie format: "${pair}". Expected name=value`);
    }
    const name = pair.substring(0, eqIndex).trim();
    const value = pair.substring(eqIndex + 1).trim();
    return normaliseCookie({ name, value }, hostname);
  });
}

/** Normalise a raw cookie object into a CookieEntry with defaults */
function normaliseCookie(obj: Record<string, unknown>, hostname: string): CookieEntry {
  return {
    name: String(obj.name),
    value: String(obj.value),
    domain: obj.domain ? String(obj.domain) : `.${hostname}`,
    path: obj.path ? String(obj.path) : '/',
    secure: typeof obj.secure === 'boolean' ? obj.secure : true,
    httpOnly: typeof obj.httpOnly === 'boolean' ? obj.httpOnly : false,
    sameSite: validateSameSite(obj.sameSite),
    expirationDate: typeof obj.expirationDate === 'number'
      ? obj.expirationDate
      : Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year default
  };
}

function validateSameSite(val: unknown): CookieEntry['sameSite'] {
  const valid = ['no_restriction', 'lax', 'strict', 'unspecified'];
  if (typeof val === 'string' && valid.includes(val)) {
    return val as CookieEntry['sameSite'];
  }
  return 'lax';
}
