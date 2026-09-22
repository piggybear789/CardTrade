// lib/seo/site.ts
//
// The canonical public origin, and helpers for building absolute URLs from it.
//
// ONE COPY OF THE SEO ORIGIN. `NEXT_PUBLIC_SITE_URL ?? 'https://noditto.app'`
// was written out three times — `app/layout.tsx` (which feeds `metadataBase`),
// `app/robots.ts` and `app/sitemap.ts` — and the structured data added alongside
// them would have been a fourth. Every one of those has to agree, because a
// canonical tag, an OpenGraph `url` and a sitemap entry that disagree about the
// origin are three crawlers' worth of duplicate-content signal.
//
// DELIBERATELY SEPARATE from the origin resolution in `lib/actions/auth.ts`,
// `lib/actions/merchant.ts`, `lib/identity/identityReturn.ts` and the
// `app/auth/*` route handlers. Those fall back to `http://localhost:3000` and
// climb a forwarded-host ladder, because a provider return URL has to point at
// the machine the member is actually using — sending a local dev session to
// noditto.app would break onboarding. A canonical tag has the opposite
// requirement: it must name the PUBLIC origin even when rendered somewhere else,
// since emitting `http://localhost:3000/listings/…` into production metadata
// would de-index the page. Merging the two would force one of them to be wrong.

/**
 * The public origin, without a trailing slash.
 *
 * Set `NEXT_PUBLIC_SITE_URL` per environment. The fallback is the production
 * origin rather than localhost on purpose: an unset variable that silently
 * canonicalises production to localhost is unrecoverable from the outside, while
 * an unset variable in local dev only makes the dev sitemap name the live host,
 * which nothing consumes.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://noditto.app'
).replace(/\/+$/, '');

/**
 * Join a root-relative path onto {@link SITE_URL}.
 *
 * Structured data needs genuinely absolute URLs — unlike the `alternates` and
 * `openGraph` fields in a Next `Metadata` object, which `metadataBase` resolves
 * for us. JSON-LD gets no such treatment, so a relative `url` or `@id` in a
 * graph is simply wrong rather than merely unconventional.
 *
 * @param path root-relative path, with or without a leading slash
 */
export function absoluteUrl(path: string): string {
  if (!path || path === '/') return SITE_URL;
  return `${SITE_URL}/${path.replace(/^\/+/, '')}`;
}

/** Dimensions of the generated social card. Shared with `app/og/route.tsx`. */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/**
 * The default social card, for any route with no better image of its own.
 *
 * NAMED EXPLICITLY BY EVERY ROUTE THAT SETS `openGraph`, and that is not
 * belt-and-braces. Next resolves `openGraph` by REPLACING the parent's resolved
 * value rather than merging into it, so a route stating its own title and url
 * discards whatever image it would otherwise have inherited — and it also skips
 * the file-convention fallback when the key is merely PRESENT, which means
 * `images: undefined` silently suppresses it too. Spread this instead of writing
 * `images: x ? [x] : undefined`.
 *
 * A listing overrides it with the card's own photograph, which is always the
 * better image when there is one.
 */
export const DEFAULT_OG_IMAGE = {
  url: '/og',
  ...OG_IMAGE_SIZE,
  alt: 'NoDitto — buy, sell and swap trading cards with verified sellers',
} as const;
