'use client';

// components/sales/HandoverFailedDialog.tsx
//
// The Cash_Sale binding of the shared "the exchange did not happen" dialog.
//
// The form itself — reason, evidence, false-report warning — now lives in
// `components/fulfilment/HandoverFailedDialog`, so the trade room gets the same
// escape hatch. Before that, a trade had none at all: a no-show or a parcel that
// never arrived left the trade sitting until the collateral authorisation lapsed.
//
// What stays here is the part that is genuinely sale-specific: raising a dispute
// against money the platform already holds, and being honest that a refund is one of
// three possible outcomes rather than a promise.

import { HandoverFailedDialog as SharedHandoverFailedDialog } from '@/components/fulfilment';
import { disputeCashSale } from '@/lib/actions/cashSale';

/** Messages for the typed errors `disputeCashSale` can return. */
const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Please sign in again.',
  'not-participant': 'You are not part of this contract.',
  'invalid-state': 'This contract cannot be disputed in its current state.',
  'invalid-terms': 'Please provide a description of the issue.',
};

export interface HandoverFailedDialogProps {
  cashSaleId: string;
  /** Contextual label for the trigger button. */
  triggerLabel?: string;
  triggerVariant?: 'outline' | 'destructive' | 'default' | 'secondary' | 'ghost';
}

export function HandoverFailedDialog({
  cashSaleId,
  triggerLabel = 'Report handover failed',
  triggerVariant,
}: HandoverFailedDialogProps) {
  return (
    <SharedHandoverFailedDialog
      triggerLabel={triggerLabel}
      triggerVariant={triggerVariant}
      title="Report handover failed"
      evidenceContext={{ caseKind: 'CASH_SALE', caseRef: cashSaleId }}
      // States what actually happens, not what we hope happens. This previously
      // promised "the buyer is refunded", which was untrue in two ways: nothing
      // refunded automatically, and a refund is only one of three outcomes.
      outcomeDescription="Describe what went wrong. This raises a dispute and freezes the money — nothing is released to either side until NoDitto support reviews it. They can refund you in full, refund part of it, or decide the sale stands. You will be notified of the outcome."
      reasonPlaceholder="e.g. Item not as described, seller didn't show up, package arrived damaged…"
      onSubmit={async (reason) => {
        const result = await disputeCashSale(cashSaleId, reason);
        if (result.ok) return { ok: true };
        return {
          ok: false,
          message:
            ERROR_MESSAGES[result.error] ??
            result.message ??
            'Could not raise the dispute.',
        };
      }}
    />
  );
}
