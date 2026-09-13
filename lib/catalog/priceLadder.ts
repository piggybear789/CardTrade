// lib/catalog/priceLadder.ts
//
// The non-linear price ladder the catalog's range slider lands on, and the histogram
// that sits above it.
//
// EXTRACTED FROM `CatalogControls` SO THE SERVER CAN SHARE IT. The ladder used to be a
// set of private functions inside that client component, which was fine while it only
// drove the thumbs. It stopped being fine when the price control gained a histogram:
// the bars have to be bucketed against the SAME stops the thumbs snap to, or a bar and
// the thumb beside it describe different prices — which is worse than having no
// histogram, because it looks authoritative.
//
// Pure, no React, no Supabase: `lib/actions/listings.ts` builds the buckets during the
// facets query and `CatalogControls` renders them, both from this one definition.

/** Price ceiling used when nothing is listed yet, so the slider still spans. */
export const FALLBACK_CEILING_CENTS = 100_000;

/** Price slider stops below $10, where the bulk of listings sit. */
const LOW_PRICE_STOPS_CENTS = [0, 200, 500];

/**
 * Multipliers applied per decade. Chosen so every stop lands on a whole number of
 * dollars at each decade, so no stop needs cents.
 */
const PRICE_DECADE_MULTIPLIERS = [1, 1.5, 2, 3, 4, 5, 7.5];

/**
 * Round a cents figure up to the next 1, 2, or 5 × 10ⁿ. Used for the slider's top end
 * so the track reads in round numbers and only moves when inventory crosses an order of
 * magnitude, rather than on every new high-value listing.
 */
export function niceCeilingCents(cents: number): number {
  if (!Number.isFinite(cents) || cents <= 0) return FALLBACK_CEILING_CENTS;
  const magnitude = 10 ** Math.floor(Math.log10(cents));
  for (const multiple of [1, 2, 5]) {
    const candidate = multiple * magnitude;
    if (candidate >= cents) return candidate;
  }
  return 10 * magnitude;
}

/**
 * The prices the range slider can land on, a handful per order of magnitude rather than
 * one uniform step. A catalog spanning a few dollars to a few thousand leaves a linear
 * track no good option: a step fine enough for cheap cards takes hundreds of key presses
 * to cross, and one coarse enough to cross is wider than most listings are worth.
 * Stepping by magnitude keeps the low end precise and the top end reachable.
 */
export function buildPriceLadderCents(ceilingCents: number): number[] {
  const stops = LOW_PRICE_STOPS_CENTS.filter((cents) => cents < ceilingCents);
  for (let decadeCents = 1000; decadeCents < ceilingCents; decadeCents *= 10) {
    for (const multiplier of PRICE_DECADE_MULTIPLIERS) {
      const cents = multiplier * decadeCents;
      if (cents < ceilingCents) stops.push(cents);
    }
  }
  stops.push(ceilingCents);
  return stops;
}

/**
 * Ladder position closest to a price, for seeding the thumbs from the URL. Hand-written
 * URLs can name any amount; the thumb takes the nearest stop.
 */
export function nearestPriceStop(ladder: number[], cents: number): number {
  let nearest = 0;
  let smallestGap = Infinity;
  for (let stop = 0; stop < ladder.length; stop += 1) {
    const gap = Math.abs(ladder[stop] - cents);
    if (gap < smallestGap) {
      nearest = stop;
      smallestGap = gap;
    }
  }
  return nearest;
}

/**
 * How many listings fall in each ladder segment, as a share of the busiest segment.
 *
 * ONE VALUE PER SEGMENT, NOT PER STOP: a ladder of N stops has N-1 gaps between them,
 * and a bar describes a gap. Returning N would leave the last bar standing for a range
 * with no upper bound.
 *
 * NORMALISED TO 0..1 rather than returned as counts, because the caller draws bar
 * heights and the absolute counts are not otherwise useful to it — and because a shape
 * is what the control is for. A buyer reading it wants "most of the stock is under $50",
 * not "there are 41 listings between $20 and $30". Counts stay available via
 * `CatalogFacets.total` if a tooltip ever wants them.
 *
 * An empty catalog returns all zeroes, which renders as a flat baseline rather than as
 * a misleading uniform distribution.
 */
export function priceHistogram(ladder: number[], pricesCents: number[]): number[] {
  const segments = Math.max(ladder.length - 1, 0);
  if (segments === 0) return [];

  const counts = new Array<number>(segments).fill(0);
  for (const cents of pricesCents) {
    if (!Number.isFinite(cents) || cents < 0) continue;
    // Walk from the top so a price sitting exactly on a stop counts in the segment it
    // opens rather than the one it closes — the same convention the thumbs use, where
    // landing on a stop includes it.
    let segment = segments - 1;
    while (segment > 0 && cents < ladder[segment]) segment -= 1;
    counts[segment] += 1;
  }

  const busiest = Math.max(...counts);
  if (busiest === 0) return counts;
  return counts.map((n) => n / busiest);
}
