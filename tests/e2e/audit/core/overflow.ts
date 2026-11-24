// tests/e2e/audit/core/overflow.ts
//
// THE HORIZONTAL OVERFLOW RULE, and the skeleton selector list, for the e2e UX audit
// suite. Pure: no Playwright, no DOM, no I/O. The in-page collector (`audit/ux/overflow.ts`,
// lifted from `debug/horizontal-overflow.probe.spec.ts`) reads the document's
// `scrollWidth`, the viewport's `innerWidth` and the widest boxes crossing the right edge
// with the ancestor that clipped each (or null); this module decides.
//
// Requirements:
//   30.2  the document wider than the viewport is a UX_Observation       (overflowFindings)
//   30.3  a skeleton, shimmer or placeholder shape is a UX_Observation   (SKELETON_SELECTORS,
//         read by `audit/ux/skeleton.ts`; structure.md: there are no `loading.tsx` files
//         and no skeleton placeholders anywhere in the web app)
//
// Both checks default to blocking (`uxPolicy.ts`).

/** How many CSS px the document may exceed the viewport by (sub-pixel rounding). */
export const OVERFLOW_TOLERANCE_PX = 1;

/** How many offending boxes an observation names. */
export const MAX_OFFENDERS = 5;

/**
 * Selectors for a skeleton, shimmer or placeholder shape (Req 30.3). Any match is an
 * observation. `animate-pulse` is Tailwind's skeleton pulse; it is not a spinner.
 */
export const SKELETON_SELECTORS: readonly string[] = [
  '.animate-pulse',
  '[class*=skeleton]',
  '[class*=shimmer]',
  '[data-skeleton]',
];

/**
 * A busy region is a placeholder only when it has no text: the collector matches this
 * selector and reports an element whose trimmed `textContent` is empty. A busy button
 * that still says "Saving…" is not a placeholder.
 */
export const BUSY_PLACEHOLDER_SELECTOR = '[aria-busy="true"]';

/** A box crossing the viewport's right edge, as the probe describes it. */
export interface OverflowOffender {
  /** `tag#id.class…` */
  selector: string;
  /** `getBoundingClientRect().right`, in CSS px. */
  right: number;
  width: number;
  /** The first ancestor with `overflow-x` other than `visible`, or null when none clipped it. */
  clippedBy: string | null;
}

/** What the collector read for one page at the end of a step. */
export interface OverflowReading {
  /** `document.documentElement.scrollWidth`. */
  scrollWidth: number;
  /** `window.innerWidth`. */
  innerWidth: number;
  offenders?: readonly OverflowOffender[];
}

/** One overflow problem. The caller adds member, URL and severity. */
export interface OverflowObservation {
  check: 'overflow';
  message: string;
  detail?: Record<string, string | number>;
}

/**
 * Returns one observation when the document is wider than the viewport by more than
 * `tolerance` (default 1 px), else an empty array (Req 30.2). The observation names the
 * widest unclipped offenders (those reaching past the same edge with nothing to absorb
 * them), up to `MAX_OFFENDERS`, rightmost first. Clipped boxes never cause a sideways
 * scroll and are not named. Throws on a non-finite width.
 */
export function overflowFindings(
  reading: OverflowReading,
  tolerance: number = OVERFLOW_TOLERANCE_PX,
): OverflowObservation[] {
  const { scrollWidth, innerWidth } = reading;
  if (!Number.isFinite(scrollWidth) || !Number.isFinite(innerWidth)) {
    throw new RangeError('scrollWidth and innerWidth must be finite');
  }
  const excess = scrollWidth - innerWidth;
  if (excess <= tolerance) return [];
  const offenders = (reading.offenders ?? [])
    .filter((offender) => offender.clippedBy === null && offender.right > innerWidth + tolerance)
    .sort((a, b) => b.right - a.right || a.selector.localeCompare(b.selector))
    .slice(0, MAX_OFFENDERS);
  const named = offenders.map((offender) => `${offender.selector} (right ${Math.round(offender.right)})`);
  return [
    {
      check: 'overflow',
      message:
        `Page is ${Math.round(excess)} px wider than the ${Math.round(innerWidth)} px viewport` +
        (named.length > 0 ? `; widest: ${named.join(', ')}.` : '.'),
      detail: {
        scrollWidth,
        innerWidth,
        excess,
        offenders: offenders.map((offender) => offender.selector).join(' | '),
      },
    },
  ];
}
