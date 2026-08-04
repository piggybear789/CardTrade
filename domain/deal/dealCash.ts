// domain/deal/dealCash.ts
//
// CASH SETTLEMENT POLICY FOR PRIVATE DEALS.
//
// Face-to-face / delivery handover is for goods and inspection only. Any
// `cash_amount_cents` on a deal settles through Stripe — never as physical cash
// at the meetup. Collateral (DittoBond / unverified stake) is a separate
// safety layer and is resolved by `dealCollateral.ts`.
//
// Lifecycle (mirrors Stripe charge-and-refund):
//   * Both confirm → charge/hold cash from the payer (platform escrow).
//   * Both mark complete → keep that charge as settlement to the recipient
//     (platform payout), or route to the recipient's merchant when direct
//     payout is available.
//   * Dispute → cash stays locked with any collateral holds.
//
// Pure module: no I/O, no Supabase, no provider types. Amounts are integer AUD
// cents.

/** Inputs needed to decide whether a deal has a Stripe cash leg. */
export interface DealCashBasis {
  /** `deals.cash_amount_cents` — null/0 means goods-for-goods. */
  cashAmountCents: number | null | undefined;
  /** Profile id of the party who pays the cash component. */
  cashPayerId: string | null | undefined;
  /** Deal creator profile id. */
  creatorId: string;
  /** Counterparty profile id — null while the share link is unjoined. */
  counterpartyId: string | null | undefined;
}

/** Resolved cash settlement plan for a deal, or `null` when there is none. */
export interface DealCashSettlement {
  /** Cash amount charged from the payer, in integer AUD cents. */
  amountCents: number;
  /** Profile id charged via Stripe. */
  payerId: string;
  /** Profile id who receives the settled cash. */
  recipientId: string;
}

/**
 * True when the deal records a positive cash component that should settle
 * through Stripe (not at the handover).
 */
export function dealHasCashComponent(
  cashAmountCents: number | null | undefined,
): boolean {
  return typeof cashAmountCents === 'number' && cashAmountCents > 0;
}

/**
 * Resolve who pays and who receives for a deal's Stripe cash leg.
 *
 * Returns `null` when there is no cash component, the payer is unset, or the
 * counterparty has not joined yet (recipient cannot be determined).
 */
export function resolveDealCashSettlement(
  basis: DealCashBasis,
): DealCashSettlement | null {
  if (!dealHasCashComponent(basis.cashAmountCents)) return null;
  const amountCents = Math.round(basis.cashAmountCents as number);
  if (!Number.isInteger(amountCents) || amountCents <= 0) return null;

  const payerId = basis.cashPayerId ?? null;
  const counterpartyId = basis.counterpartyId ?? null;
  if (!payerId || !counterpartyId) return null;

  if (payerId !== basis.creatorId && payerId !== counterpartyId) {
    return null;
  }

  const recipientId =
    payerId === basis.creatorId ? counterpartyId : basis.creatorId;

  return { amountCents, payerId, recipientId };
}
