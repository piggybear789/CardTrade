// domain/state-machine/holdLegs.ts
//
// The two TradeFacts legs that come from `pre_auth_holds` rather than from the trade
// row: whether each trader's collateral is live, and whether either trader's attempt
// to place it ended without a live hold.
//
// WHY IT IS ITS OWN MODULE. `factsFromTrade` in `lib/actions/tradeLifecycleStore.ts` is
// `server-only` and reads the trade row alone, defaulting both of these to false —
// which is correct for deciding a shipping transition and wrong for the contract room,
// where `collateralSeekFailed` picks the "a card declined" copy and `holdsActive`
// decides whether the release step is finished. So the browser room derived them
// itself, and serving the same plan to the Flutter client would have made a THIRD
// copy of one rule. This is that rule, once, in the pure layer both callers may
// import.
//
// Pure: no Supabase, no React, no service imports.

/** The subset of a `pre_auth_holds` row this derivation reads. */
export interface HoldRowLike {
  trader_id: string;
  status: string;
  /** ISO 8601. Ordering only — the LATEST hold per trader is the live opinion. */
  created_at?: string;
}

/** The two legs a hold set contributes to a {@link import('./types').TradeFacts}. */
export interface HoldLegs {
  holdsActive: { initiator: boolean; counterpart: boolean };
  /**
   * True when either trader's collateral attempt ended without a live hold — a
   * decline, a void, or a lapsed authorisation. Not per-trader on purpose: the trade
   * is stuck either way, and the room's copy asks whoever is reading it to replace
   * their card and retry.
   */
  collateralSeekFailed: boolean;
}

/** A hold status that ended the attempt rather than leaving collateral in place. */
function seekEnded(status: string | undefined): boolean {
  return status === 'FAILED' || status === 'VOIDED' || status === 'EXPIRED';
}

/**
 * Read the hold legs for one trade.
 *
 * A trader may have several holds — a decline followed by a retry — so only the most
 * recently created one counts. Ordering is by `created_at` as a string, which is
 * correct for ISO 8601 and avoids parsing dates for a comparison.
 */
export function deriveHoldLegs(
  holds: readonly HoldRowLike[],
  initiatorId: string,
  counterpartId: string,
): HoldLegs {
  const latestStatus = (traderId: string): string | undefined => {
    const theirs = holds
      .filter((hold) => hold.trader_id === traderId)
      .toSorted((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
    return theirs[theirs.length - 1]?.status;
  };

  const initiatorStatus = latestStatus(initiatorId);
  const counterpartStatus = latestStatus(counterpartId);

  return {
    holdsActive: {
      initiator: initiatorStatus === 'ACTIVE',
      counterpart: counterpartStatus === 'ACTIVE',
    },
    collateralSeekFailed: seekEnded(initiatorStatus) || seekEnded(counterpartStatus),
  };
}
