// lib/layout/viewportHint.ts
//
// The server's best guess at the viewport tier, for the first paint of a request.
//
// `useIsDesktop` and `useContractSplit` take their server snapshot from a hint, and the
// hint normally comes from the `nd_vw` cookie the browser wrote on its previous render.
// That cookie is session-scoped, so it is ABSENT on a first-ever visit, on every new
// browser session, and on the first page after following an email link — and with no
// hint both hooks answered "phone". A desktop visitor's first page was therefore
// rendered as the phone tree and rebuilt at hydration: the catalog's filters jumped out
// of the content column into the rail, and a contract room swapped from the thread to
// the split with its header inserted above it.
//
// The fallback is the request's own device signal. `Sec-CH-UA-Mobile` is a default
// (low-entropy) client hint Chromium sends on every request; other engines get a
// conservative user-agent check. Anything ambiguous — a tablet, an unrecognised agent —
// returns `undefined`, which keeps the old phone-first behaviour. A wrong guess costs
// exactly what a stale cookie already did: one correction at hydration.

export interface ViewportHintGuess {
  isDesktop: boolean;
  isSplit: boolean;
}

const PHONE: ViewportHintGuess = { isDesktop: false, isSplit: false };
const DESKTOP: ViewportHintGuess = { isDesktop: true, isSplit: true };

/** Parse the `nd_vw` cookie value written by `ViewportHintWriter`. */
export function parseViewportCookie(value: string | undefined): ViewportHintGuess | undefined {
  if (!value) return undefined;
  return { isDesktop: value.includes('d'), isSplit: value.includes('s') };
}

/**
 * Guess from request headers. `undefined` means "no confident answer".
 *
 * A desktop agent is assumed to be wide enough for the contract split (1024px). That is
 * true of almost every desktop window; a narrow one corrects at hydration, as before.
 */
export function guessViewportFromHeaders(
  get: (name: string) => string | null,
): ViewportHintGuess | undefined {
  const mobileHint = get('sec-ch-ua-mobile');
  if (mobileHint === '?1') return PHONE;
  if (mobileHint === '?0') return DESKTOP;

  const ua = get('user-agent') ?? '';
  if (!ua) return undefined;
  // Phones identify themselves with "Mobi" (Android Chrome, Firefox, Safari on iPhone).
  if (/Mobi|iPhone|iPod/i.test(ua)) return PHONE;
  // Tablets sit on both sides of the 768/1024 splits; do not guess.
  if (/iPad|Android|Tablet|Silk|Kindle/i.test(ua)) return undefined;
  if (/Windows NT|Macintosh|X11|CrOS|Linux x86_64/i.test(ua)) return DESKTOP;
  return undefined;
}
