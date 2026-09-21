// lib/images/optimizable.ts
//
// Whether a given image URL may be routed through `next/image`.
//
// WHY THIS IS A PREDICATE AND NOT A POLICY EVERY CALL SITE REMEMBERS. Before
// this, the app answered the question by hand at roughly twenty-five `<img>`
// tags, each carrying its own `eslint-disable @next/next/no-img-element`, and the
// aggregate answer was "no" everywhere except the catalog tile. So a listing page
// served up to ten full-resolution phone photos — the 56px filmstrip thumbnails
// included — straight from the Storage origin.
//
// Routing them through the optimizer is the fix, but it CANNOT be applied
// blindly: `next/image` THROWS at runtime on a host that is not in
// `images.remotePatterns`, which turns a slow image into a broken page. Three
// kinds of URL legitimately reach these components and must not be optimised:
//
//   1. Signed URLs for the PRIVATE buckets — dispute evidence, message
//      attachments, private-deal evidence. `/storage/v1/object/sign/...?token=`
//      does not match the configured pathname, and an optimised copy cached at
//      the edge would outlive the short-lived grant it was fetched under.
//   2. OAuth profile pictures. `avatarUrl` passes absolute URLs through as-is,
//      so a Google sign-in lands `lh3.googleusercontent.com`, which is not a
//      configured host.
//   3. `blob:` and `data:` previews from the upload form, which are local bytes
//      the optimizer cannot fetch at all.
//
// Asking the URL is cheaper and safer than auditing every caller, and it stays
// correct when a new caller appears.
//
// Isomorphic on purpose — no `server-only`, no imports — because the same
// decision is made in Server Components and in `'use client'` galleries.

/**
 * Bare host allowed with no path restriction.
 *
 * Only the seeded card-scan CDNs. Both are read-only third-party hosts serving
 * nothing but card images, so there is no private path to exclude.
 */
const OPEN_HOSTS = new Set(['images.pokemontcg.io']);

/**
 * Public-object prefix on a Supabase Storage host.
 *
 * The `public/` segment is the load-bearing part: it is what distinguishes a
 * cacheable object from a signed one, and it is the pathname
 * `next.config.ts` matches.
 */
const SUPABASE_PUBLIC_PREFIX = '/storage/v1/object/public/';

/**
 * Can `src` be handed to `next/image`?
 *
 * MUST AGREE WITH `images.remotePatterns` IN `next.config.ts`. The two are a
 * matched pair — this function decides whether to call the optimizer and that
 * config decides whether the optimizer accepts it, so a host present here and
 * absent there is a runtime throw rather than a fallback. Widen both together.
 *
 * Deliberately conservative: an unrecognised URL returns `false` and the caller
 * renders a plain `<img>`, which is exactly the behaviour the whole app had
 * before. The worst case for a mistake here is the old, slow path, never a
 * broken image.
 *
 * @param src Absolute URL, root-relative path, or nullish.
 * @returns `true` when `next/image` will accept it.
 */
export function isOptimizableImageUrl(src: string | null | undefined): boolean {
  if (!src) return false;

  // Local bytes. `blob:` is an upload preview and `data:` is an inlined
  // placeholder; the optimizer runs server-side and can fetch neither.
  if (src.startsWith('blob:') || src.startsWith('data:')) return false;

  // Root-relative — our own origin, always available to the optimizer. This is
  // how the static brand assets in `/public` are referenced.
  if (src.startsWith('/')) return true;

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    // Not a URL we can reason about (a bare filename, a malformed string).
    return false;
  }

  // `remotePatterns` pins `protocol: 'https'` on every entry.
  if (url.protocol !== 'https:') return false;

  if (OPEN_HOSTS.has(url.hostname)) return true;

  // Scrydex is scoped to `/pokemon/**` in `next.config.ts`, so scope it here
  // too rather than trusting the whole host.
  if (url.hostname === 'images.scrydex.com') {
    return url.pathname.startsWith('/pokemon/');
  }

  // Any Supabase project host, public objects only. `endsWith` on a
  // dot-prefixed suffix so `evil-supabase.co` cannot match.
  if (url.hostname.endsWith('.supabase.co')) {
    return url.pathname.startsWith(SUPABASE_PUBLIC_PREFIX);
  }

  return false;
}
