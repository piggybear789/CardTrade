// components/profile/SellerTrustBand.tsx
//
// The full-width band of checkable facts under a seller's name.
//
// WHY IT IS ONE BAND AND NOT TWO RAILS. The design board tried this as a left rail of
// trust facts beside a right rail of listings, and the rails did not agree on height:
// a seller with a trading name and four sold cards made the left one taller than a
// seller without, so the grid beside it started at a different y on every profile. A
// full-width band has one height, whatever is in it, and the listings below it always
// begin in the same place.
//
// TWO GROUPS, ONE CONTAINER, HAIRLINE BETWEEN. The top group is what the PROVIDER
// verified against a government document; the bottom group is what the PLATFORM has
// recorded. The container is one box because the page should not read as a pile of
// unrelated cards — that was the other half of the complaint — but the rule between
// the groups is load-bearing, not decorative. `is_verified` asserts a document check;
// a completed-sales count asserts contracts settling. Running them together under one
// shield line would lend Stripe's assurance to a figure Stripe knows nothing about,
// which is the same mistake the seller page's own comment warns about for the bio.
//
// THE BIO STAYS OUT OF HERE. It is member-authored, so it is presented as their words
// in the header and nowhere near a verified fact. See the note at its render site.
//
// WHY PHONES GET A TWO-COLUMN GRID RATHER THAN ONE SENTENCE. The board sketched the
// phone collapse as a single run-on line ("Sarah M. Chen · checked 12 Mar 2026 · 14
// sales"). Getting there from this DOM means either hiding the `dt` labels — and "14"
// on its own is not a fact — or carrying a second phrasing of every value so the label
// can be folded into it, which puts two strings per fact in the source and reads both
// of them to a screen reader. The complaint this band answers was that nothing lined
// up; a two-column grid answers it at 320px in three rows.

import { HugeiconsIcon } from '@hugeicons/react';
import { ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { regionLabel } from '@/domain/region/regions';
import { formatShortDate } from '@/lib/format';

export interface SellerTrustBandProps {
  /**
   * Provider-verified legal name, or null when this member holds no disclosure.
   *
   * Null is the normal state for a buy-only member: they never receive money, so they
   * are never asked to verify. Its absence must not be dressed up as a warning — see
   * `IdentityBadge`, which renders nothing rather than "not verified".
   */
  legalName: string | null;
  /** Provider-reported trading name, when the seller registered one. */
  tradingName: string | null;
  /** ISO instant the identity check passed. */
  verifiedAt: string | null;
  /**
   * The member's trading jurisdiction (`profiles.region_code`), ISO 3166-1 alpha-2.
   *
   * This is where they can COMPLETE a contract, not where a given card is sitting.
   * `items.location_country_code` is that, and the two are deliberately separate.
   */
  regionCode: string | null;
  /**
   * Completed cash sales, or null when the viewer may not read the aggregate.
   *
   * `member_sale_stats` is granted to `authenticated` alone, so a signed-out visitor
   * gets null here. Null and zero are NOT the same and must not render the same: a
   * guest seeing "Completed sales 0" for a seller with forty of them would be worse
   * than a guest seeing no figure at all.
   */
  completedSales: number | null;
}

/**
 * One column of the band: a label above a value.
 *
 * A FIXED THREE COLUMNS, NOT `auto-fit`. The first cut used
 * `repeat(auto-fit, minmax(8.5rem, 1fr))`, which sizes each group to its OWN content —
 * so the provider group's three facts became three thirds while the record group's two
 * became two halves, and "Completed sales" sat under "Verified name" while "Trades in"
 * landed between "Store" and "ID checked", aligned with nothing.
 *
 * That is the exact complaint this band was built to answer, reintroduced one level
 * down. Both groups now declare the same three tracks, so every fact in the band shares
 * a column with the fact above it and a short group simply leaves its last track empty.
 */
const FACT_GRID = [
  // Phone: two columns, so five facts are three rows rather than five.
  'grid grid-cols-2 gap-x-group gap-y-cozy',
  'sm:grid-cols-3 sm:gap-y-0',
].join(' ');

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      {/* `break-words` because a verified legal name is provider-supplied and can be
          longer than the column it lands in; `tabular-nums` costs nothing on text and
          keeps the counts from shifting. */}
      <dd className="break-words text-body font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * A seller's checkable facts, or nothing at all when there are none.
 *
 * Returns null rather than an empty box when a member holds no disclosure and no
 * readable record — which is exactly a buy-only member's profile, and rendering a
 * bordered "no information" panel on it would invent a deficiency.
 */
export function SellerTrustBand({
  legalName,
  tradingName,
  verifiedAt,
  regionCode,
  completedSales,
}: SellerTrustBandProps) {
  const checkedOn = formatShortDate(verifiedAt);
  const region = regionCode ? regionLabel(regionCode) : null;

  const verified = Boolean(legalName);
  const hasRecord = completedSales !== null || Boolean(region);

  if (!verified && !hasRecord) return null;

  return (
    <section
      aria-label="Seller checks"
      className="mt-cozy rounded-lg border bg-muted/60"
    >
      {verified ? (
        <div className="p-group">
          {/* Same glyph as `IdentityBadge`: one fact, one icon vocabulary. The claim
              is a document plus a selfie, which is what the Identity_Gate has actually
              checked since 0069 — never anything about being payable, which is a
              separate later step a verified member may not have taken. */}
          <h3 className="text-trust mb-cozy flex items-center gap-tight text-body font-medium">
            <HugeiconsIcon icon={ShieldCheckIcon} className="h-4 w-4 shrink-0" aria-hidden />
            Verified with photo ID by Stripe
          </h3>
          <dl className={FACT_GRID}>
            <Fact label="Verified name" value={legalName!} />
            {tradingName ? <Fact label="Store" value={tradingName} /> : null}
            {checkedOn ? <Fact label="ID checked" value={checkedOn} /> : null}
          </dl>
        </div>
      ) : null}

      {hasRecord ? (
        // `border-t` only when something sits above it, or an unverified member's band
        // would open with a rule against its own top edge.
        <dl className={`${FACT_GRID} p-group ${verified ? 'border-t' : ''}`}>
          {completedSales !== null ? (
            <Fact
              label="Completed sales"
              value={String(completedSales)}
            />
          ) : null}
          {region ? <Fact label="Trades in" value={region} /> : null}
        </dl>
      ) : null}
    </section>
  );
}
