// domain/bond/currentHolds.ts
//
// Which of a trade's hold rows is the one that counts (ESC-07, ESC-08).
//
// A trader can have several `pre_auth_holds` rows on one trade: a declined attempt
// stays on file as FAILED, a released one as VOIDED, and a retry writes a NEW row
// under a new idempotency key. Every caller that picked "the" hold with
// `holds.find(h => h.traderId === id)` got the OLDEST row, so a dispute could try to
// capture a FAILED attempt's key while the live authorisation sat untouched until it
// lapsed. And "every current hold is ACTIVE" over the rows that exist was true when
// only ONE trader had a row, which let a single provider event lock a trade with half
// its collateral missing.
//
// This module is the one definition of both questions. Pure: no Supabase, React or
// service imports.

import type { PreAuthHold } from '../services/types';

/** The fields every hold read needs to answer "which row counts". */
export interface HoldLike {
  traderId: string;
  holdRef: string;
  status: PreAuthHold['status'];
  /** Insertion instant. When every row has one, it orders the history. */
  createdAt?: string | null;
  /** Set when the custody backstop captured the hold into the platform balance (0133). */
  custodyCapturedAt?: string | null;
}

/**
 * A trader's hold rows oldest first.
 *
 * Ordered by `createdAt` when every row carries one, otherwise the caller's order is
 * kept (the repositories read `order by created_at`). Never mixes the two, because a
 * comparator that only sometimes has a key is not a consistent order.
 */
function historyOf<H extends HoldLike>(holds: readonly H[], traderId: string): H[] {
  const mine = holds.filter((hold) => hold.traderId === traderId);
  const dated = mine.every((hold) => typeof hold.createdAt === 'string' && hold.createdAt);
  if (!dated) return mine;
  return [...mine].sort(
    (a, b) => Date.parse(a.createdAt as string) - Date.parse(b.createdAt as string),
  );
}

/** A trader's latest hold row, whatever its status. */
export function currentHold<H extends HoldLike>(
  holds: readonly H[],
  traderId: string,
): H | undefined {
  const history = historyOf(holds, traderId);
  return history[history.length - 1];
}

/**
 * Whether a hold still stands behind the trade: an open authorisation, a legacy
 * partial capture whose money the platform still holds, or a custody capture.
 *
 * A FULLY_CAPTURED row WITHOUT `custodyCapturedAt` is a finished fraud capture, not a
 * live hold, and is deliberately excluded.
 */
export function isLiveHold(hold: HoldLike): boolean {
  if (hold.status === 'ACTIVE' || hold.status === 'PARTIALLY_CAPTURED') return true;
  return hold.status === 'FULLY_CAPTURED' && Boolean(hold.custodyCapturedAt);
}

/**
 * The trader's latest LIVE hold (ESC-07): the row a resolution may capture, refund or
 * void. Later FAILED or VOIDED attempts never shadow it, because a declined retry
 * does not release the authorisation that was already in place.
 */
export function currentLiveHold<H extends HoldLike>(
  holds: readonly H[],
  traderId: string,
): H | undefined {
  const history = historyOf(holds, traderId);
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (isLiveHold(history[i])) return history[i];
  }
  return undefined;
}

/** The latest hold row per trader that has any, in first-seen order. */
export function currentHoldsByTrader<H extends HoldLike>(holds: readonly H[]): H[] {
  const traders: string[] = [];
  for (const hold of holds) {
    if (!traders.includes(hold.traderId)) traders.push(hold.traderId);
  }
  return traders
    .map((traderId) => currentHold(holds, traderId))
    .filter((hold): hold is H => hold !== undefined);
}

/**
 * True only when EVERY listed trader's latest hold is ACTIVE (ESC-08).
 *
 * Replaces `currentHoldsAreActive`, which checked only the rows that existed and so
 * reported a trade fully collateralised when one trader had no hold at all.
 */
export function currentHoldsCoverTraders(
  holds: readonly HoldLike[],
  traderIds: readonly string[],
): boolean {
  if (traderIds.length === 0) return false;
  return traderIds.every((traderId) => currentHold(holds, traderId)?.status === 'ACTIVE');
}
