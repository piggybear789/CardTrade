'use client';

// components/sales/CashSaleDemoControls.tsx
//
// Demo-only controls for simulating the Pinch payment settlement webhook that
// advances a Cash_Sale from PAYMENT_PENDING to ESCROW_HELD (or FAILED). In
// production, this transition arrives via a `transfer.settled` webhook from
// Pinch; in test mode with localhost Pinch can't deliver it, so this button
// self-posts the signed webhook via the `fireCashSaleWebhook` server action.

import { useState, useTransition } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  fireCashSaleWebhook,
  type DemoCashSaleWebhookKind,
  type FireCashSaleWebhookError,
} from '@/lib/actions/demo';

const ERROR_MESSAGES: Record<FireCashSaleWebhookError, string> = {
  unauthenticated: 'Please sign in to use the demo controls.',
  'not-participant': 'Only participants in this sale can use the demo controls.',
  'delivery-failed': 'The simulated webhook could not be delivered.',
  rejected: 'This sale cannot accept that event in its current state.',
};

const SUCCESS_MESSAGES: Record<DemoCashSaleWebhookKind, string> = {
  'settle-payment': 'Payment settled — funds are now held in escrow.',
  'fail-payment': 'Payment failure delivered — the sale has been cancelled.',
};

export function CashSaleDemoControls({ cashSaleId }: { cashSaleId: string }) {
  const [activeKind, setActiveKind] = useState<DemoCashSaleWebhookKind | null>(null);
  const [isPending, startTransition] = useTransition();

  function fire(kind: DemoCashSaleWebhookKind) {
    setActiveKind(kind);
    startTransition(async () => {
      const result = await fireCashSaleWebhook(cashSaleId, kind);
      if (result.ok) {
        if (result.deduped) {
          toast.info('That webhook was already processed for this sale.');
        } else {
          toast.success(SUCCESS_MESSAGES[kind]);
        }
      } else {
        toast.error(result.detail ?? ERROR_MESSAGES[result.error]);
      }
      setActiveKind(null);
    });
  }

  const busy = (kind: DemoCashSaleWebhookKind) => isPending && activeKind === kind;

  return (
    <div className="rounded-lg border border-dashed border-amber-500/50 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical className="size-4 text-amber-600" aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">
          Test mode
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        In production, Pinch delivers a webhook when the payment clears. Simulate
        that here to advance the contract.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          size="sm"
          onClick={() => fire('settle-payment')}
          disabled={isPending}
          aria-busy={busy('settle-payment')}
        >
          {busy('settle-payment') ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : null}
          Simulate payment settled
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => fire('fail-payment')}
          disabled={isPending}
          aria-busy={busy('fail-payment')}
        >
          {busy('fail-payment') ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : null}
          Simulate payment failed
        </Button>
      </div>
    </div>
  );
}
