'use client';

// components/admin/ReturnCaseActions.tsx
//
// The only way out of a STALLED return (0088/0089), for staff.
//
// WHY THIS IS NOT PART OF `DisputeActions`. That component decides the MERITS of a
// dispute — who was right about the goods — and its three outcomes carry a refund
// amount. This decides something narrower: an operator has ALREADY found for the buyer,
// the refund was made conditional on the goods coming back, and the condition has
// stalled. The only question left is whether it counts as met.
//
// It was also, for a while, missing entirely. `resolveCashSaleDispute` refuses anything
// that is not DISPUTED, and a sale in the return flow already carries a dispute
// resolution — so it hit an idempotency guard and reported SUCCESS while doing nothing.
// Staff could press resolve, be told the case was settled, and leave both parties
// waiting on a decision that had not been made.

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { resolveCashSaleReturnCase } from '@/lib/actions/admin';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatAud } from '@/lib/format';

type ReturnOutcome = 'REFUND_BUYER' | 'RELEASE_SELLER';

export interface ReturnCaseActionsProps {
  cashSaleId: string;
  amountCents: number;
  /** Whether a carrier confirmed the return actually reached the seller. */
  returnConfirmed: boolean;
  /** Why this is on the queue: the seller contested it, or nobody posted it. */
  reason: 'CONTESTED' | 'LAPSED';
}

export function ReturnCaseActions({
  cashSaleId,
  amountCents,
  returnConfirmed,
  reason,
}: ReturnCaseActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<ReturnOutcome | null>(null);

  /** What the operator is actually about to do, in money terms. */
  function effectOf(outcome: ReturnOutcome): string {
    if (outcome === 'REFUND_BUYER') {
      return returnConfirmed
        ? `${formatAud(amountCents)} goes back to the buyer and the listing returns to the catalog, because the carrier confirmed the seller has the item.`
        // Stated plainly: the operator is deciding on evidence outside the record, so
        // the platform will not also claim the seller has goods it cannot prove.
        : `${formatAud(amountCents)} goes back to the buyer. The listing is NOT relisted, because nothing confirms the seller has the item — they can relist it themselves if they do.`;
    }
    return reason === 'LAPSED'
      ? `No refund. The buyer keeps the item and ${formatAud(amountCents)} is released to the seller, less the platform fee. Use this when the buyer simply never sent it back.`
      : `No refund. The buyer keeps whatever they have and the money is released to the seller, less the platform fee. Use this when the return was empty, wrong, or never arrived.`;
  }

  function resolve(outcome: ReturnOutcome) {
    startTransition(async () => {
      const result = await resolveCashSaleReturnCase(cashSaleId, outcome);
      setConfirming(null);
      if (result.ok) {
        toast.success(
          outcome === 'REFUND_BUYER'
            ? `Refunded ${formatAud(amountCents)} to the buyer.`
            : 'Released to the seller.',
        );
        return;
      }
      toast.error(result.message ?? 'Could not resolve that return.');
    });
  }

  return (
    <div className="space-y-cozy">
      <p className="text-body text-muted-foreground">
        {reason === 'CONTESTED'
          ? 'The seller says the return did not arrive as expected. Decide whether it counts.'
          : 'The buyer did not post the return before the deadline. Decide whether the refund still stands.'}
      </p>

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
          Refund the buyer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          aria-haspopup="dialog"
          onClick={() => setConfirming('RELEASE_SELLER')}
        >
          Release to the seller
        </Button>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => setConfirming(open ? confirming : null)}
        title={
          confirming === 'RELEASE_SELLER' ? 'Release to the seller?' : 'Refund the buyer?'
        }
        description={confirming ? effectOf(confirming) : ''}
        confirmLabel={
          confirming === 'RELEASE_SELLER' ? 'Release' : 'Refund'
        }
        onConfirm={() => {
          if (confirming) resolve(confirming);
        }}
        pending={isPending}
      />
    </div>
  );
}
