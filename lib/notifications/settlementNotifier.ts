import 'server-only';

// lib/notifications/settlementNotifier.ts
//
// In-app notifications for the moment a transaction's money is committed — the
// event a member most wants to hear about and, until now, the one that emitted
// NOTHING (FEAT-002).
//
// TWO EVENTS LIVE HERE:
//   * Cash_Sale settlement — the Buyer's payment clears into escrow
//     (PAYMENT_PENDING -> ESCROW_HELD / HANDOVER). Both parties are told.
//   * Trade collateral locked — both card holds are confirmed and the swap is on
//     (COLLATERAL_PENDING -> COLLATERAL_LOCKED). Both traders are told.
//
// WHY IT LIVES HERE AND NOT IN THE DOMAIN. `createNotification` is `server-only`
// and inserts through the service-role client, neither of which may be reached
// from the pure `domain/` orchestrators. The action layer and the webhook
// pipeline call these helpers after the transition outcome is already decided,
// so the domain layer stays pure and Node-testable.
//
// BEST-EFFORT BY CONTRACT. `createNotification` swallows its own failures and
// returns a boolean; a failed emit must never turn a settled purchase into an
// error, nor a SUCCESS webhook into a FAILURE that makes Stripe retry.
//
// NO CURRENCY IN THE COPY. `CashSaleRecord` carries no currency field and
// hardcoding AUD is the "charged in one currency, displayed in another" bug the
// region work exists to prevent (see `proposeCashSalePrice`). The contract room
// formats the amount correctly, so the notification sends the member there.
//
// CARD-HOLD LANGUAGE FOR TRADES. A trade bond is a card hold, never "escrow"
// (product.md). The cash-sale copy may say escrow; the trade copy never does.

import { createNotification } from '@/lib/notifications/createNotification';

/**
 * Notify BOTH parties that a Cash_Sale payment has cleared into escrow.
 *
 * Distinct from the seller's earlier "Payment started" notification: this fires
 * once the funds are actually held, which is the purchase completing. Emitted
 * exactly once per purchase: the caller only reaches this after the settlement
 * transition it drove actually succeeded, so a settle that returned
 * INVALID_STATE (already settled elsewhere) never gets here.
 */
export async function notifyCashSaleSettled(params: {
  buyerId: string;
  sellerId: string;
  cashSaleId: string;
}): Promise<void> {
  const link = `/sales/${params.cashSaleId}`;
  await createNotification({
    userId: params.buyerId,
    type: 'SALE',
    title: 'Payment confirmed',
    body: 'Your payment is held safely until you receive and approve the item.',
    link,
  });
  await createNotification({
    userId: params.sellerId,
    type: 'SALE',
    title: 'Funds secured',
    body: 'The buyer has paid. The funds are held in escrow - arrange handover or postage.',
    link,
  });
}

/**
 * Notify BOTH traders that collateral is locked and the swap is on.
 *
 * "Card hold" language, never escrow (product.md): a trade bond is a hold on the
 * trader's card, not custody of money. Best-effort and emitted after the
 * COLLATERAL_LOCKED transition has committed.
 */
export async function notifyTradeCollateralLocked(params: {
  initiatorId: string;
  counterpartId: string;
  tradeId: string;
}): Promise<void> {
  const link = `/trades/${params.tradeId}`;
  const note = {
    type: 'TRADE' as const,
    title: 'Trade collateral locked',
    body: 'Both card holds are confirmed. The swap is on - ship your item or arrange the handover.',
    link,
  };
  await createNotification({ userId: params.initiatorId, ...note });
  await createNotification({ userId: params.counterpartId, ...note });
}
