// components/sales/paymentChallenge.ts
//
// Finishes a 3-D Secure check the card issuer asked for when the buyer pressed Pay
// (ESC-03). The server confirmed the payment on-session and handed back a one-time
// client secret; Stripe.js runs the bank's check in place, then the server reads the
// payment back (`confirmCashSalePayment`) rather than trusting the browser's word.
//
// Browser SDK only. The secret is used once and never stored or logged.

'use client';

import { confirmCashSalePayment, type CashSaleActionResult } from '@/lib/actions/cashSale';
import { getStripe, isRealPublishableKey } from '@/components/onboarding/stripeBrowser';

export interface PaymentNextAction {
  clientSecret: string;
  publishableKey?: string;
}

/**
 * Run the issuer's check and then read the payment back. Whatever happens in the
 * browser, the server read decides the outcome, so a closed check window leaves the
 * sale PAYMENT_PENDING (resumable with "Complete payment") rather than guessed at.
 */
export async function completePaymentChallenge(
  cashSaleId: string,
  nextAction: PaymentNextAction,
): Promise<CashSaleActionResult> {
  const key = nextAction.publishableKey ?? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (isRealPublishableKey(key)) {
    const stripe = await getStripe(key!);
    if (stripe) {
      const { error } = await stripe.handleNextAction({ clientSecret: nextAction.clientSecret });
      if (error) {
        // The check failed or was closed. The read-back below still decides; this
        // message is what the buyer sees if the payment is not complete.
        const confirmed = await confirmCashSalePayment(cashSaleId);
        if (confirmed.ok && confirmed.sale.status === 'PAYMENT_PENDING') {
          return {
            ok: false,
            error: 'transfer-failed',
            message: error.message ?? 'Your bank check was not completed. You can try again.',
          };
        }
        return confirmed;
      }
    }
  }
  return confirmCashSalePayment(cashSaleId);
}
