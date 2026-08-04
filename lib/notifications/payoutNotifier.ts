import 'server-only';

// lib/notifications/payoutNotifier.ts
//
// The production `PayoutNotifier` (Req 9).
//
// WHY IT LIVES HERE AND NOT IN THE DOMAIN. `createNotification` is `server-only`
// and inserts through the service-role client, neither of which may be reached
// from `domain/`. The orchestrator declares the interface; this module supplies
// the binding, so the payout logic stays pure and Node-testable.
//
// BEST-EFFORT BY CONTRACT. `createNotification` already swallows its own failures
// and returns a boolean, and the orchestrator wraps every call. A Member who
// cannot be notified still gets their money.
//
// NOTHING PROVIDER-SHAPED IN THE COPY (Req 9.6). No transfer reference, no
// provider error text, no retry count, and no mention of the Buyer — a payout
// notification is between CardTrade and the Seller.

import { createNotification } from '@/lib/notifications/createNotification';
import { formatAud } from '@/lib/format';
import type { PayoutNotifier } from '@/domain/orchestrator/cashSaleOrchestrator';

/** Member-safe headline and body per failure cause. */
const FAILURE_COPY = {
  NOT_PAYABLE: {
    title: 'Payout on hold — finish your payout setup',
    body: (itemTitle: string) =>
      `We are holding your proceeds for "${itemTitle}" because your payout setup is not finished. ` +
      'Complete it and we will release the money automatically.',
    link: '/profile#payouts',
  },
  PROVIDER_REJECTED: {
    title: 'Payout delayed',
    body: (itemTitle: string) =>
      `Your proceeds for "${itemTitle}" could not be sent yet. We are retrying automatically ` +
      'and your money stays held for you.',
    link: '/profile/payouts',
  },
} as const;

/**
 * The production payout notifier.
 *
 * Emitted only to the Seller of the Cash_Sale (Req 9.7): the orchestrator passes
 * `sale.sellerId`, and nothing here widens the audience.
 */
export function createPayoutNotifier(): PayoutNotifier {
  return {
    async releaseSettled({ sellerId, cashSaleId, itemTitle, netCents }) {
      await createNotification({
        userId: sellerId,
        type: 'SALE',
        title: `${formatAud(netCents)} sent to your payout account`,
        body:
          `Your proceeds for "${itemTitle}" are on their way. ` +
          'It can take up to four business days to appear in your account.',
        link: `/sales/${cashSaleId}`,
      });
    },

    async releaseFailed({ sellerId, cashSaleId, itemTitle, cause }) {
      const copy = FAILURE_COPY[cause];
      await createNotification({
        userId: sellerId,
        type: 'SALE',
        title: copy.title,
        body: copy.body(itemTitle),
        // Points at the action that resolves it where one exists, and at the
        // dashboard otherwise (Req 9.2).
        link: cause === 'NOT_PAYABLE' ? copy.link : `/sales/${cashSaleId}`,
      });
    },

    async disputeResolved({
      buyerId,
      sellerId,
      cashSaleId,
      itemTitle,
      outcome,
      refundCents,
      sellerNetCents,
    }) {
      const link = `/sales/${cashSaleId}`;
      // Each side is told what happened to THEIR money, in their own terms. Sending
      // one shared message would leave one party reading about the other's balance.
      const copy = {
        REFUND_BUYER: {
          buyer: {
            title: `${formatAud(refundCents)} refunded`,
            body:
              `Your dispute over "${itemTitle}" was upheld and you have been refunded in full. ` +
              'Card refunds usually appear within a few business days.',
          },
          seller: {
            title: 'Dispute resolved — buyer refunded',
            body:
              `The dispute over "${itemTitle}" was resolved in the buyer's favour and they were ` +
              'refunded, so no proceeds are owed. The listing has been returned to the catalog.',
          },
        },
        PARTIAL_REFUND: {
          buyer: {
            title: `${formatAud(refundCents)} partially refunded`,
            body:
              `Your dispute over "${itemTitle}" was resolved with a partial refund. You keep the ` +
              'item and the difference has been returned to you.',
          },
          seller: {
            title: 'Dispute resolved — partial refund',
            body:
              `The dispute over "${itemTitle}" was resolved with ${formatAud(refundCents)} refunded ` +
              `to the buyer. ${formatAud(sellerNetCents)} is being released to you.`,
          },
        },
        RELEASE_SELLER: {
          buyer: {
            title: 'Dispute resolved — no refund',
            body:
              `After review, the dispute over "${itemTitle}" was not upheld, so the sale stands and ` +
              'no refund has been issued.',
          },
          seller: {
            title: 'Dispute resolved in your favour',
            body:
              `The dispute over "${itemTitle}" was not upheld. ${formatAud(sellerNetCents)} is being ` +
              'released to you.',
          },
        },
      }[outcome];

      await createNotification({
        userId: buyerId,
        type: 'SALE',
        title: copy.buyer.title,
        body: copy.buyer.body,
        link,
      });
      await createNotification({
        userId: sellerId,
        type: 'SALE',
        title: copy.seller.title,
        body: copy.seller.body,
        link,
      });
    },
  };
}
