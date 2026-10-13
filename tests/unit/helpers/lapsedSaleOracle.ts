// tests/unit/helpers/lapsedSaleOracle.ts
//
// The arbitration queue's marker-case rule as it stood before lapsed-sale-case-fix,
// transcribed, so the fixed rule can be held to it everywhere the fix was not meant to
// change anything.
//
// A "marker case" is a cash sale opened by a timestamp rather than by a DISPUTED status:
// `ship_lapsed_at` (0132), `return_disputed_at` (0088) or `return_lapsed_at` (0089). The
// old rule was two halves that never looked at each other:
//
//   1. the candidate READ: any of the three markers, in any of ESCROW_HELD,
//      RETURN_PENDING or RETURN_IN_TRANSIT (database null semantics), and
//   2. the LOOP: contested, else lapsed, else "Not shipped", with no status check.
//
// `ship_lapsed_at` is never cleared, so a sale that posted late and later entered a
// return fell through to the last branch and was listed as a seller who had not posted.
// That row, and its mirror (an ESCROW_HELD sale carrying a return marker), is
// `isBugCondition1`. Everywhere else the fixed rule must agree with this one exactly.
//
// Shared by the queue suite, which checks this transcription against the real action,
// and the property suite, which holds the pure rule to it.

/** Every Cash_Sale_Status, byte for byte the `CashSaleStatus` union. */
export const CASH_SALE_STATUSES = [
  'AGREEMENT',
  'PAYMENT_PENDING',
  'ESCROW_HELD',
  'IN_TRANSIT',
  'HANDOVER',
  'INSPECTION',
  'COMPLETED',
  'DISPUTED',
  'CANCELLED',
  'FAILED',
  'REFUNDED',
  'RETURN_PENDING',
  'RETURN_IN_TRANSIT',
] as const;

/** The four fields a marker case is decided from, in the pure rule's spelling. */
export interface MarkerRow {
  status: string;
  shipLapsedAt: string | null;
  returnDisputedAt: string | null;
  returnLapsedAt: string | null;
}

/** What the old rule listed a row as, or null when it did not list it. */
export type LegacyMarkerCase = {
  situation: 'SHIP_LAPSED' | 'RETURN_CONTESTED' | 'RETURN_LAPSED';
  openedAt: string | null;
} | null;

const CANDIDATE_STATUSES: ReadonlySet<string> = new Set([
  'RETURN_PENDING',
  'RETURN_IN_TRANSIT',
  'ESCROW_HELD',
]);

const RETURN_FLOW: ReadonlySet<string> = new Set(['RETURN_PENDING', 'RETURN_IN_TRANSIT']);

/**
 * The candidate read's filter, which the fix leaves as it is:
 * `.in('status', [three]).or('<any marker>.not.is.null')`.
 */
export function legacyCandidate(row: MarkerRow): boolean {
  return (
    CANDIDATE_STATUSES.has(row.status) &&
    (row.returnDisputedAt !== null || row.returnLapsedAt !== null || row.shipLapsedAt !== null)
  );
}

/** The old read plus the old loop: contested, then lapsed, then "Not shipped". */
export function legacySituationOf(row: MarkerRow): LegacyMarkerCase {
  if (!legacyCandidate(row)) return null;
  if (row.returnDisputedAt) return { situation: 'RETURN_CONTESTED', openedAt: row.returnDisputedAt };
  if (row.returnLapsedAt) return { situation: 'RETURN_LAPSED', openedAt: row.returnLapsedAt };
  return { situation: 'SHIP_LAPSED', openedAt: row.shipLapsedAt };
}

/**
 * Bug 1's condition: a marker read outside its own statuses.
 *
 * C1 is the reported defect, a running return listed as "Not shipped" because of an old
 * ship-by flag. C1' is the same defect pointing the other way, an ESCROW_HELD sale listed
 * as a return case; it is not expected in data, and is included so preservation can be
 * stated over every combination of status and markers with no exceptions.
 */
export function isBugCondition1(row: MarkerRow): boolean {
  const c1 =
    RETURN_FLOW.has(row.status) &&
    row.shipLapsedAt !== null &&
    row.returnDisputedAt === null &&
    row.returnLapsedAt === null;
  const c1Mirror =
    row.status === 'ESCROW_HELD' && (row.returnDisputedAt !== null || row.returnLapsedAt !== null);
  return c1 || c1Mirror;
}
