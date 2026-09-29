'use client';

// components/sales/PayStepDetails.tsx
//
// What the buyer needs on the Pay step besides the charge itself: the verified
// seller to confirm, and a card.
//
// THE CONFIRMATION exists for a private-deal sale, which opened before the seller
// verified. Its buyer confirms here, at the moment money moves, which verified name
// they are paying, and `acceptCashSaleTerms` freezes that onto the contract. A
// sale opened from a listing confirmed this at Buy and shows nothing extra.
//
// THE CARD is collected here when the buyer has none saved — a private deal no
// longer asks for one to join — so the step never dead-ends on "add a payment
// method somewhere else first".

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CreditCardIcon } from '@hugeicons/core-free-icons';

import { PaymentFormSkeleton } from '@/components/payments/PaymentFormSkeleton';
import { Button } from '@/components/ui/button';
import { getPaymentMethodStatus } from '@/lib/actions/payments';
import type { SellerPayReadiness } from '@/lib/sellerIdentity';

const AddPaymentMethodForm = dynamic(
  () => import('@/components/payments/AddPaymentMethodForm').then((m) => m.AddPaymentMethodForm),
  { ssr: false, loading: () => <PaymentFormSkeleton /> },
);

export type PayCard =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'saved'; label: string | null };

/** The buyer's saved card, read when the Pay step opens and again after adding one. */
export function usePayCard(active: boolean): {
  card: PayCard;
  refresh: () => void;
  replace: () => void;
} {
  const [card, setCard] = useState<PayCard>({ state: 'loading' });
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    getPaymentMethodStatus()
      .then((result) => {
        if (cancelled) return;
        setCard(
          result.ok && result.data.hasPaymentMethod
            ? { state: 'saved', label: result.data.label }
            : { state: 'none' },
        );
      })
      .catch(() => {
        if (!cancelled) setCard({ state: 'none' });
      });
    return () => {
      cancelled = true;
    };
  }, [active, reads]);

  return {
    card,
    refresh: () => {
      setCard({ state: 'loading' });
      setReads((count) => count + 1);
    },
    replace: () => setCard({ state: 'none' }),
  };
}

export function VerifiedSellerConfirmation({
  identity,
  confirmed,
  onConfirmedChange,
}: {
  identity: Extract<SellerPayReadiness, { state: 'ready' }>['identity'];
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
}) {
  return (
    <div className="grid gap-snug">
      <div className="min-w-0 rounded-md border bg-muted p-cozy text-body">
        <p className="text-muted-foreground">Verified seller, from Stripe Identity</p>
        <p className="break-words font-medium">{identity.legalEntityName}</p>
        {identity.tradingName ? (
          <p className="break-words text-muted-foreground">Trading as {identity.tradingName}</p>
        ) : null}
      </div>
      <label className="flex cursor-pointer items-center gap-snug text-body">
        <input
          type="checkbox"
          className="size-4 shrink-0"
          checked={confirmed}
          onChange={(event) => onConfirmedChange(event.target.checked)}
        />
        This is who I&apos;m paying
      </label>
    </div>
  );
}

export function PayCardSection({
  card,
  onAttached,
  onReplace,
}: {
  card: PayCard;
  onAttached: () => void;
  onReplace: () => void;
}) {
  if (card.state === 'loading') {
    return (
      <div role="status" aria-label="Checking your payment card">
        <PaymentFormSkeleton />
      </div>
    );
  }

  if (card.state === 'none') {
    return (
      <div className="grid gap-cozy">
        <div className="grid gap-tight">
          <p className="text-body font-medium">Add a card to pay</p>
          <p className="text-body text-muted-foreground">
            Stripe stores the card. It is charged only when you confirm below.
          </p>
        </div>
        <AddPaymentMethodForm onAttached={onAttached} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-cozy rounded-lg border p-cozy">
      <HugeiconsIcon icon={CreditCardIcon} className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium">{card.label ?? 'Card on file'}</p>
        <p className="text-body text-muted-foreground">Stripe method</p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onReplace}>
        Change
      </Button>
    </div>
  );
}
