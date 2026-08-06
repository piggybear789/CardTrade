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
}

/** Resolve one disputed sale. */
export function DisputeActions({
  cashSaleId,
  amountCents,
  platformFeeCents,
}: DisputeActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [partialDollars, setPartialDollars] = useState('');
  const [confirming, setConfirming] = useState<CashSaleDisputeOutcome | null>(null);

  const partialCents = Math.round(Number.parseFloat(partialDollars || '0') * 100);
  const partialValid =
    Number.isFinite(partialCents) && partialCents > 0 && partialCents < amountCents;

  const sellerNet = (refund: number) =>
    Math.max(Math.max(amountCents - platformFeeCents, 0) - refund, 0);

  /** Plain-language money effect, shown before the operator commits. */
  function effectOf(outcome: CashSaleDisputeOutcome): string {
    switch (outcome) {
      case 'REFUND_BUYER':
        return `${formatAud(amountCents)} goes back to the buyer. The seller receives nothing and the listing returns to the catalog.`;
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
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/30 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Scale className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        Resolve this dispute
      </p>

      <div className="flex flex-wrap items-center gap-2">
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

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0">
          <Label htmlFor={`partial-${cashSaleId}`} className="text-xs">
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
          className="w-full text-xs text-muted-foreground"
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
