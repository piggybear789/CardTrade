'use client';

// components/admin/DisputeActions.tsx
//
// Operator controls for resolving a disputed Cash_Sale (Req 4.15).
//
// WHY THIS SCREEN MATTERS. Before it existed, `disputeCashSale` was a one-way
// door: a sale went to DISPUTED and stayed there, with the Buyer's money parked in
// the platform balance and no code path anywhere that could return it or release
// it. The Buyer had meanwhile been told, in the dispute dialog, that they would be
// refunded.
//
// THREE OUTCOMES, and the choice is consequential, so it asks for confirmation and
// states the money effect in words before acting:
//
//   Refund buyer     full refund; the sale ends REFUNDED and the item relists
//   Partial refund   buyer keeps the item at a reduced price; seller gets the rest
//   Release seller   dispute not upheld; seller is paid in full
//
// Retrying is safe. The refund reuses the sale's persisted nonce, so a provider
// timeout followed by a second attempt is deduplicated rather than refunding twice
// out of platform funds.

import { useState, useTransition } from 'react';
import { Loader2, Scale } from 'lucide-react';
import { toast } from 'sonner';

import { resolveCashSaleDispute } from '@/lib/actions/admin';
import type { CashSaleDisputeOutcome } from '@/domain/orchestrator/cashSaleOrchestrator';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { formatAud } from '@/lib/format';

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Your session has expired. Please sign in again.',
  'not-authorized': 'You are not authorized to resolve disputes.',
  'not-found': 'That sale no longer exists.',
  'persistence-error': 'The dispute could not be resolved.',
};

export interface DisputeActionsProps {
  cashSaleId: string;
  /** Total collected from the Buyer, in cents. Bounds a partial refund. */
  amountCents: number;
  /** Platform fee already computed on the sale, for the effect summary. */
  platformFeeCents: number;
  /**
   * Whether the record shows the Buyer actually received the goods (0088).
   *
   * Derived server-side by the same rule the orchestrator uses, and passed in rather
   * than re-derived here so the operator is shown the outcome that will ACTUALLY
   * happen. When true, a full refund waits on the item coming back.
   */
  buyerHasGoods?: boolean;
  /**
   * Provider reference of an OPEN chargeback on this same sale, if any.
   *
   * The buyer has gone to their bank AND an operator is about to refund from the platform
   * balance. Stripe caps total reversals at the original charge, so nobody is paid twice —
   * but the platform eats a dispute fee for a refund it did not need to issue, and a
   * refund attempted after the reversal lands just fails, which reads as a provider fault
   * rather than the predictable collision it is.
   */
  openChargebackRef?: string | null;
}

/** Resolve one disputed sale. */
export function DisputeActions({
  cashSaleId,
  amountCents,
  platformFeeCents,
  buyerHasGoods = false,
  openChargebackRef = null,
}: DisputeActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [partialDollars, setPartialDollars] = useState('');
  const [confirming, setConfirming] = useState<CashSaleDisputeOutcome | null>(null);
  // Operator override: "there is nothing to send back". Off by default, so the
  // record's own account of events wins unless someone deliberately overrides it.
  const [nothingToReturn, setNothingToReturn] = useState(false);

  const partialCents = Math.round(Number.parseFloat(partialDollars || '0') * 100);
  const partialValid =
    Number.isFinite(partialCents) && partialCents > 0 && partialCents < amountCents;

  /** Whether a full refund will route through the return flow as things stand. */
  const willRequireReturn = buyerHasGoods && !nothingToReturn;

  const sellerNet = (refund: number) =>
    Math.max(Math.max(amountCents - platformFeeCents, 0) - refund, 0);

  /** Plain-language money effect, shown before the operator commits. */
  function effectOf(outcome: CashSaleDisputeOutcome): string {
    switch (outcome) {
      case 'REFUND_BUYER':
        // SUPERSEDED BY 0088. This used to promise the money moved and the listing
        // relisted immediately, which is now only true when nothing has to come back.
        // An operator deciding a case has to be told which of the two they are doing.
        return willRequireReturn
          ? `The buyer must post the item back first. ${formatAud(amountCents)} is refunded automatically once the carrier confirms it reached the seller, and the listing returns to the catalog at that point. Nothing moves now.`
          : `${formatAud(amountCents)} goes back to the buyer immediately. The seller receives nothing and the listing returns to the catalog.`;
      case 'PARTIAL_REFUND':
        return `${formatAud(partialCents)} goes back to the buyer, who keeps the item. ${formatAud(sellerNet(partialCents))} is released to the seller.`;
      case 'RELEASE_SELLER':
        return `No refund. ${formatAud(sellerNet(0))} is released to the seller and the sale completes.`;
    }
  }

  function resolve(outcome: CashSaleDisputeOutcome) {
    startTransition(async () => {
      const result = await resolveCashSaleDispute(
        cashSaleId,
        outcome,
        outcome === 'PARTIAL_REFUND' ? partialCents : undefined,
        // Only meaningful on a full refund, and only sent when the operator has
        // actually overridden — otherwise the orchestrator derives it, which is the
        // behaviour that protects a seller nobody is paying attention to.
        outcome === 'REFUND_BUYER' && nothingToReturn ? false : undefined,
      );
      setConfirming(null);
      if (result.ok) {
        toast.success(
          result.data.refundCents > 0
            ? `Resolved. ${formatAud(result.data.refundCents)} refunded to the buyer.`
            : 'Resolved. Released to the seller.',
        );
        return;
      }
      // The action's own message distinguishes a bad amount from a provider
      // refusal, which is exactly what an operator needs to decide what to do next.
      toast.error(result.message ?? ERROR_MESSAGES[result.error] ?? 'Resolution failed.');
    });
  }

  return (
    <div className="space-y-cozy rounded-lg border border-border/70 bg-muted/30 p-cozy">
      <p className="flex items-center gap-snug text-body font-medium">
        <Scale className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        Resolve this dispute
      </p>

      {/* THE BUYER HAS ALREADY GONE TO THEIR BANK. Stated before the outcome buttons,
          because it changes which outcome makes sense: refunding here pays a dispute fee
          for money the issuer is reversing anyway. Not a block — an operator may have a
          reason, and the chargeback may yet be won — but they should not learn about it
          from a failed refund. */}
      {openChargebackRef ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-cozy py-snug text-body"
        >
          <span className="font-semibold">A chargeback is open on this sale.</span>{' '}
          The buyer disputed the payment with their bank ({openChargebackRef}). The issuer
          may reverse it regardless of what you decide here, and refunding as well costs a
          dispute fee without paying the buyer any more than they will already receive.
          Check the chargeback case before refunding.
        </p>
      ) : null}

      {/* The override, shown ONLY when the record says the buyer has the goods —
          otherwise there is nothing to override and the control would be noise. This
          is the empty-box case: the carrier confirmed a delivery, so the derivation
          says "make them return it", but the operator can see there was nothing in
          the parcel to return. Without this, the buyer's refund waits on a condition
          they cannot satisfy. */}
      {buyerHasGoods ? (
        <label className="flex items-start gap-snug text-body">
          <input
            type="checkbox"
            checked={nothingToReturn}
            onChange={(event) => setNothingToReturn(event.target.checked)}
            disabled={isPending}
            className="mt-0.5 size-4 shrink-0 accent-destructive"
          />
          <span>
            There is nothing to send back
            <span className="block text-muted-foreground">
              Tick this if the parcel was empty, held the wrong item, or never actually
              reached the buyer despite the carrier marking it delivered. A full refund
              then pays out immediately instead of waiting on a return.
            </span>
          </span>
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-snug">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={isPending}
          aria-haspopup="dialog"
          onClick={() => setConfirming('REFUND_BUYER')}
        >
          {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Refund buyer in full
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          aria-haspopup="dialog"
          onClick={() => setConfirming('RELEASE_SELLER')}
        >
          Release to seller
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-snug">
        <div className="min-w-0">
          <Label htmlFor={`partial-${cashSaleId}`} className="text-meta">
            Partial refund
          </Label>
          <MoneyInput
            id={`partial-${cashSaleId}`}
            value={partialDollars}
            onChange={(event) => setPartialDollars(event.target.value)}
            className="mt-1 h-9 w-32"
            aria-describedby={`partial-help-${cashSaleId}`}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending || !partialValid}
          aria-haspopup="dialog"
          onClick={() => setConfirming('PARTIAL_REFUND')}
        >
          Partially refund
        </Button>
        <p
          id={`partial-help-${cashSaleId}`}
          className="w-full text-body text-muted-foreground"
        >
          Must be more than zero and less than the {formatAud(amountCents)} collected.
          Use a full refund or a release for those.
        </p>
      </div>

      {confirming ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          title="Resolve this dispute?"
          description={`${effectOf(confirming)} This moves real money and cannot be undone from here.`}
          confirmLabel="Resolve"
          confirmVariant={confirming === 'REFUND_BUYER' ? 'destructive' : 'default'}
          pending={isPending}
          onConfirm={() => resolve(confirming)}
        />
      ) : null}
    </div>
  );
}
