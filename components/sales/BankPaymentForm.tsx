'use client';

// components/sales/BankPaymentForm.tsx
//
// Approving a bank payment for a cash sale (0158): Payment Element mounted against the
// PaymentIntent the server opened for the ONE rail the buyer chose, then
// `stripe.confirmPayment`. Redirect rails (iDEAL, Bancontact, EPS, Przelewy24) leave for
// the bank and come back to the room through `return_url`; PayTo and US bank accounts
// usually finish in place. Whatever the browser reports, the server read-back
// (`confirmCashSalePayment`) decides the outcome.
//
// Loaded on demand, like the card form: Stripe.js and Elements are only fetched by a
// buyer who chose to pay from their bank. No bank details pass through our code; they
// live in Stripe's iframe.

import { useMemo, useState, useTransition } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderCircleIcon, LockIcon } from '@hugeicons/core-free-icons';

import { getStripe, isRealPublishableKey } from '@/components/onboarding/stripeBrowser';
import { Button } from '@/components/ui/button';
import { confirmCashSalePayment, type CashSaleActionResult } from '@/lib/actions/cashSale';

export interface BankPaymentFormProps {
  cashSaleId: string;
  clientSecret: string;
  publishableKey?: string;
  /** "Pay A$103.20 with PayTo". */
  submitLabel: string;
  /** Called with the server's read-back once the bank step ends in this window. */
  onFinished: (result: CashSaleActionResult) => void;
}

export function BankPaymentForm(props: BankPaymentFormProps) {
  const key = props.publishableKey ?? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const stripePromise = useMemo(() => (isRealPublishableKey(key) ? getStripe(key!) : null), [key]);

  if (!stripePromise) {
    // The mock settles every rail synchronously, so this is reached only on a
    // misconfigured deployment. Read the payment back rather than guess.
    return (
      <Button
        type="button"
        className="w-full"
        onClick={() => void confirmCashSalePayment(props.cashSaleId).then(props.onFinished)}
      >
        Check payment
      </Button>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: props.clientSecret,
        appearance: { theme: 'flat', variables: { borderRadius: '0.5rem' } },
      }}
    >
      <BankPaymentFields {...props} />
    </Elements>
  );
}

function BankPaymentFields({ cashSaleId, submitLabel, onFinished }: BankPaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!stripe || !elements) {
      setError('Secure checkout is not ready yet. Please wait a moment.');
      return;
    }
    startTransition(async () => {
      // Back to this room after a redirect rail; the room reads the payment back on
      // arrival. `if_required` keeps in-place rails (PayTo, US bank) on this page.
      const returnUrl = `${window.location.origin}/sales/${cashSaleId}?payment=return`;
      const confirmed = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: 'if_required',
      });
      if (confirmed.error) {
        setError(confirmed.error.message ?? 'Your bank did not approve the payment. You can try again.');
        return;
      }
      onFinished(await confirmCashSalePayment(cashSaleId));
    });
  }

  const busy = isPending || !ready;

  return (
    <form onSubmit={handleSubmit} className="space-y-group">
      {/* Reserve the skeleton's height until Stripe's iframe has laid out, so the
          dialog does not collapse and re-expand while it mounts (see the card form). */}
      <div className={ready ? undefined : 'min-h-40'}>
        <PaymentElement onReady={() => setReady(true)} options={{ layout: 'tabs' }} />
      </div>
      <Button type="submit" disabled={busy} aria-busy={busy} className="w-full">
        {busy ? <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden /> : null}
        {!ready ? (
          'Loading secure checkout…'
        ) : isPending ? (
          'Waiting for your bank…'
        ) : (
          <>
            <HugeiconsIcon icon={LockIcon} className="size-3.5" aria-hidden />
            {submitLabel}
          </>
        )}
      </Button>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
