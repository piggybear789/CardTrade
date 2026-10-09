// components/profile/SellerTrustBand.tsx
//
// A seller's checkable facts, as one row under their name.
//
// ONE ROW, ONLY WHAT EXISTS. This was a two-group grid of five labelled cells that
// always rendered, with an em dash wherever the seller had nothing — so most profiles
// showed a box of dashes ("Store —", "ID checked —") that read as gaps in the seller
// rather than as facts. Now each fact appears only when there is one to state, and
// they run as a single line a buyer reads in one pass. The rating stays beside the
// name in the header, where it links to the reviews.
//
// TWO GROUPS, STILL. What Stripe verified against a document leads, in the trust
// colour; what NoDitto recorded (sales, tenure, trading region) follows in muted type
// after a rule. Running them together would lend Stripe's assurance to a sales count
// Stripe knows nothing about.
//
// THE BIO STAYS OUT OF HERE. It is member-authored, so it is presented as their words
// in the header and nowhere near a verified fact.

import { HugeiconsIcon } from '@hugeicons/react';
import { ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { regionLabel } from '@/domain/region/regions';
import { displayLegalName, formatMonthYear, formatShortDate } from '@/lib/format';

export interface SellerTrustBandProps {
  /**
   * Provider-verified legal name, or null when this member holds no disclosure.
   *
   * Null is the normal state for a buy-only member: they never receive money, so they
   * are never asked to verify. Its absence is not dressed up as a warning.
   */
  legalName: string | null;
  /** Provider-reported trading name, when the seller registered one. */
  tradingName: string | null;
  /** ISO instant the identity check passed. */
  verifiedAt: string | null;
  /** The member's trading jurisdiction (`profiles.region_code`), ISO 3166-1 alpha-2. */
  regionCode: string | null;
  /**
   * Completed cash sales, or null when the viewer may not read the aggregate.
   *
   * `member_sale_stats` is granted to `authenticated` alone, so a signed-out visitor
   * gets null and sees no figure — never a zero for a seller with forty sales.
   */
  completedSales: number | null;
  /** The month the account was created (`public_profiles.member_since`, 0127). */
  memberSince: string | null;
}

/**
 * Facts as running text. INLINE, NOT FLEX: a flex row wrapped with the separator at
 * the start of the next line ("· checked 21 Sept"). Here the dot is joined to the
 * fact before it by a non-breaking space, so a line can only break after a dot.
 */
function FactRun({ facts }: { facts: readonly string[] }) {
  return facts.map((fact, index) => (
    <span key={fact}>
      {fact}
      {index < facts.length - 1 ? (
        <span aria-hidden className="text-muted-foreground/60">
          {'\u00A0· '}
        </span>
      ) : null}
    </span>
  ));
}

export function SellerTrustBand({
  legalName,
  tradingName,
  verifiedAt,
  regionCode,
  completedSales,
  memberSince,
}: SellerTrustBandProps) {
  const verified = Boolean(legalName);
  const checkedOn = formatShortDate(verifiedAt);
  const since = formatMonthYear(memberSince);
  const region = regionCode ? regionLabel(regionCode) : null;

  const verifiedFacts = [
    displayLegalName(legalName),
    tradingName,
    checkedOn ? `checked ${checkedOn}` : null,
  ].filter((fact): fact is string => Boolean(fact));

  const recordFacts = [
    completedSales !== null
      ? `${completedSales} ${completedSales === 1 ? 'sale' : 'sales'}`
      : null,
    since ? `Member since ${since}` : null,
    region ? `Trades in ${region}` : null,
  ].filter((fact): fact is string => Boolean(fact));

  if (!verified && recordFacts.length === 0) return null;

  return (
    <section
      aria-label="Seller checks"
      className="mt-cozy flex flex-wrap items-center gap-x-group gap-y-tight rounded-lg border bg-muted/60 px-group py-cozy text-body"
    >
      {verified ? (
        <p className="flex min-w-0 items-start gap-tight font-medium text-trust">
          <HugeiconsIcon icon={ShieldCheckIcon} className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <FactRun facts={['ID verified by Stripe', ...verifiedFacts]} />
          </span>
        </p>
      ) : null}
      {verified && recordFacts.length > 0 ? (
        <span aria-hidden className="hidden h-4 w-px bg-border sm:block" />
      ) : null}
      {recordFacts.length > 0 ? (
        <p className="min-w-0 tabular-nums text-muted-foreground">
          <FactRun facts={recordFacts} />
        </p>
      ) : null}
    </section>
  );
}
