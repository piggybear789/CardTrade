// lib/format.ts
//
// Small formatting helpers shared across the UI. Money is stored as integer AUD
// cents end-to-end (e.g. `fmv_cents`); the UI formats to AUD for display.

/** The Storage bucket that holds item images (public read). */
const ITEM_IMAGES_BUCKET = 'item-images';

/**
 * Format an integer number of AUD cents as a localized AUD currency string.
 *
 * Examples: `formatAud(0) === "$0.00"`, `formatAud(12345) === "$123.45"`,
 * `formatAud(99999999999) === "$999,999,999.99"`.
 *
 * Non-finite inputs fall back to `$0.00`. Fractional cents are rounded to the
 * nearest whole cent so the output always has exactly two decimal places.
 */
export function formatAud(cents: number): string {
  const safeCents = Number.isFinite(cents) ? Math.round(cents) : 0;
  const dollars = safeCents / 100;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    currencyDisplay: 'symbol',
  }).format(dollars);
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
 * Format an Australian business registration number for display: an 11-digit
 * number reads as an ABN (`XX XXX XXX XXX`), a 9-digit number as an ACN
 * (`XXX XXX XXX`). Anything else (e.g. a non-AU registration) is returned
 * unchanged. Used wherever a provider-approved seller identity is disclosed
 * (buy confirmation, offer confirmation, seller profile).
 */
export function formatRegistrationNumber(value: string): string {
  if (/^\d{11}$/.test(value)) {
    return `ABN ${value.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4')}`;
  }
  if (/^\d{9}$/.test(value)) {
    return `ACN ${value.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')}`;
  }
  return value;
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
