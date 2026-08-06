// lib/format.ts
//
// Small formatting helpers shared across the UI. Money is stored as an integer
// number of the currency's SMALLEST unit end-to-end (e.g. `fmv_cents`), and each
// money-bearing row carries the currency it is denominated in (0068).

import {
  FALLBACK_REGION,
  minorToMajor,
  regionCurrency,
  regionLocale,
  REGIONS,
} from '@/domain/region';

/** The Storage bucket that holds item images (public read). */
const ITEM_IMAGES_BUCKET = 'item-images';

/** The Storage bucket that holds profile avatars (public read). */
const PROFILE_IMAGES_BUCKET = 'profile-images';

/**
 * The fallback region's currency presentation, for the few surfaces that have no
 * currency in scope at all.
 *
 * These used to be the ONLY currency in the system and were documented as "not a
 * localisation seam". That is no longer true: with more than one region live, a
 * money figure is meaningless without the currency it is denominated in, so
 * anything showing an amount should reach for {@link formatMoney} or
 * {@link currencyPresentation} with a real currency instead of these.
 *
 * They remain because `money-input.tsx` renders a symbol INSIDE an input for a
 * value the member is about to type, and a handful of catalog surfaces still infer
 * the currency from the browse region rather than the row.
 */
export const CURRENCY_CODE = (regionCurrency(FALLBACK_REGION) ?? 'aud').toUpperCase();
export const CURRENCY_LOCALE = regionLocale(FALLBACK_REGION) ?? 'en-AU';
export const CURRENCY_SYMBOL = currencySymbol(CURRENCY_CODE);

/**
 * Format an integer minor-unit amount in a given currency.
 *
 * Minor units, NOT cents: `formatMoney(12345, 'aud') === "$123.45"` but
 * `formatMoney(12345, 'jpy') === "¥12,345"`, because the yen has no subunit.
 * `minorToMajor` owns that division, so the divisor is never assumed here.
 *
 * Non-finite inputs fall back to zero rather than rendering `NaN` into a money
 * field. An unrecognised currency code falls back to the default presentation and
 * is NOT thrown on: a display helper must not be able to take down a contract room
 * over a bad label. Arithmetic paths get the strict treatment instead — see
 * `assertMinorUnitSupported`.
 *
 * @param minorUnits integer amount in the currency's smallest unit
 * @param currency   ISO 4217 code, any casing
 * @param locale     BCP 47 locale; defaults to the currency's usual region
 */
export function formatMoney(
  minorUnits: number,
  currency: string,
  locale?: string,
): string {
  const code = (currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    return formatMoney(minorUnits, CURRENCY_CODE, CURRENCY_LOCALE);
  }

  try {
    return new Intl.NumberFormat(locale ?? localeForCurrency(code), {
      style: 'currency',
      currency: code,
      currencyDisplay: 'symbol',
    }).format(minorToMajor(minorUnits, code));
  } catch {
    // `Intl` throws on a syntactically valid but unknown currency. Degrade to a
    // readable figure rather than losing the amount entirely.
    const major = Number.isFinite(minorUnits) ? Math.round(minorUnits) / 100 : 0;
    return `${code} ${major.toFixed(2)}`;
  }
}

/**
 * Format an amount in the fallback region's currency.
 *
 * @deprecated Prefer {@link formatMoney} with the currency from the row being
 * displayed. Kept so the ~100 existing call sites keep compiling while they are
 * migrated; every one of them is showing an amount whose currency is now knowable.
 */
export function formatAud(cents: number): string {
  return formatMoney(cents, CURRENCY_CODE, CURRENCY_LOCALE);
}

/** How a currency should be presented: its symbol and the locale to format in. */
export interface CurrencyPresentation {
  /** ISO 4217, uppercase. */
  code: string;
  /** Localised symbol, e.g. `$`, `£`, `¥`. */
  symbol: string;
  locale: string;
}

/**
 * Everything a money INPUT needs to label itself.
 *
 * Inputs are the one place a bare symbol is right: the member is typing an amount
 * whose currency is fixed by their region and stated by the surrounding form, so
 * repeating the code in the label is the noise `money-input.tsx` exists to remove.
 */
export function currencyPresentation(currency: string): CurrencyPresentation {
  const code = (currency ?? '').trim().toUpperCase();
  const safe = /^[A-Z]{3}$/.test(code) ? code : CURRENCY_CODE;
  return {
    code: safe,
    symbol: currencySymbol(safe),
    locale: localeForCurrency(safe),
  };
}

/**
 * The locale whose conventions best suit a currency.
 *
 * Derived from the region table so there is one source for it, with the first
 * region using that currency winning — arbitrary but stable, and it only affects
 * digit grouping. EUR resolves to `en-IE`, the English-speaking eurozone locale.
 *
 * Does NOT read the module-level `CURRENCY_LOCALE` constant, because
 * `CURRENCY_SYMBOL` is initialised by calling into here and would read it before
 * assignment. `REGIONS` is an imported const, so it is fully evaluated before this
 * module's body runs.
 */
function localeForCurrency(code: string): string {
  const lower = code.toLowerCase();
  for (const region of REGIONS) {
    if (region.currency === lower) return region.locale;
  }
  return regionLocale(FALLBACK_REGION) ?? 'en-AU';
}

/** Extract just the symbol Intl would render for a currency. */
function currencySymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat(localeForCurrency(code), {
      style: 'currency',
      currency: code,
      currencyDisplay: 'symbol',
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

/**
 * Build the public URL for an item image stored as an object path in the public
 * `item-images` Storage bucket.
 *
 * The path is what we persist in `image_paths` (e.g. `"<owner>/<uuid>/0.jpg"`).
 * Follows Supabase's public object URL pattern:
 * `{SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}`.
 *
 * Returns `null` when there is no path or the Supabase URL is unavailable, so
 * callers can render a graceful placeholder.
 */
export function itemImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;

  // Absolute URLs (e.g. an image already hosted in another Storage bucket or a
  // remote CDN) are used as-is. Only relative object paths are resolved against
  // the item-images bucket.
  if (/^https?:\/\//i.test(path)) return path;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;

  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBase}/storage/v1/object/public/${ITEM_IMAGES_BUCKET}/${normalizedPath}`;
}

/**
 * Build the public URL for a profile avatar stored as an object path in the public
 * `profile-images` bucket, or `null` when there is none.
 *
 * Separate from {@link itemImageUrl} rather than a shared helper with a bucket
 * argument: the two buckets have DIFFERENT rules — 2 MB and no GIF for avatars
 * against 10 MB and GIF allowed for item photos — and a single function taking a
 * bucket name would invite passing the wrong one, which fails as a silent 404
 * rather than a type error.
 *
 * Returns `null` for a missing path so every caller must handle the no-avatar
 * case explicitly. Most members have no avatar, so that branch is the common one,
 * not an edge case: render initials (see `components/ui/avatar.tsx`).
 */
export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;

  // An absolute URL is an external avatar (a seeded demo profile, or an OAuth
  // provider's picture) and is used as-is.
  if (/^https?:\/\//i.test(path)) return path;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;

  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBase}/storage/v1/object/public/${PROFILE_IMAGES_BUCKET}/${normalizedPath}`;
}

/**
 * Up to two initials for a display name, for the avatar fallback.
 *
 * This is the DEFAULT presentation, not a degraded one: every member predates
 * avatars and most will never set one, so these initials are what the marketplace
 * mostly looks like. They must always produce something — a blank circle beside a
 * name reads as a broken image.
 *
 * Takes the first letter of the first and last whitespace-separated words, so
 * "Ada Lovelace" gives "AL" and "kitsunearia" gives "K". Falls back to `'?'` for a
 * name with no alphanumeric characters at all (an emoji-only alias), because
 * returning `''` would collapse the circle.
 */
export function initialsFor(displayName: string | null | undefined): string {
  const words = (displayName ?? '')
    .trim()
    .split(/\s+/)
    // Strip anything that is not a letter or digit so punctuation and emoji do
    // not become an "initial".
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word.length > 0);

  if (words.length === 0) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return `${first}${last}`.toLocaleUpperCase();
}

/**
 * Format an ISO timestamp as a short, human-readable relative time such as
 * `"just now"`, `"5m ago"`, `"3h ago"`, `"2d ago"`, or an absolute date for
 * anything older than a week. Used by the messaging UI for message and
 * conversation timestamps.
 *
 * Falsy/invalid inputs return an empty string so callers can render nothing.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return '';
  const then = new Date(iso);
  const ms = then.getTime();
  if (!Number.isFinite(ms)) return '';

  const diffSeconds = Math.round((now.getTime() - ms) / 1000);

  // Future or near-now timestamps read as "just now" rather than a negative age.
  if (diffSeconds < 45) return 'just now';

  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  // Older than a week: show an absolute, localized date (no time-of-day).
  return then.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

/**
 * Format an ISO timestamp as the absolute local date + time used across every
 * contract room (cash sale, 2-way trade, private deal) — e.g.
 * `"Tue, 28 Jul, 3:04 pm"`.
 *
 * Deliberately absolute rather than relative: contract rooms are rendered on the
 * server and hydrated in the browser, and a relative label ("3h ago") computed
 * at two different instants produces a hydration mismatch.
 *
 * Returns `null` for missing or unparseable input so callers can render nothing.
 */
export function formatContractDateTime(
  iso: string | null | undefined,
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      });
}
