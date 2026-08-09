'use client';

// components/sales/CashSaleDemoControls.tsx
//
// Demo-only controls for simulating the Stripe payment settlement webhook that
// advances a Cash_Sale from PAYMENT_PENDING to ESCROW_HELD (funds confirmed)
// or FAILED. Collapsed by default and labelled as hackathon / test mode so they
// never read as production payment steps.

import { useState, useTransition } from 'react';
import { ChevronDown, ChevronUp, FlaskConical, Loader2 } from 'lucide-react';
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
  'demo-disabled': 'Mock payment demos are disabled while Stripe is live.',
  rejected: 'This sale cannot accept that event in its current state.',
};

const SUCCESS_MESSAGES: Record<DemoCashSaleWebhookKind, string> = {
  'settle-payment': 'Payment settled — NoDitto is now holding the funds.',
  'fail-payment': 'Payment failure delivered — the sale has been cancelled.',
};

export function CashSaleDemoControls({ cashSaleId }: { cashSaleId: string }) {
  const [open, setOpen] = useState(false);
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
    <section
      className="cardtrade-demo rounded-lg border border-dashed"
      aria-label="Hackathon test mode controls"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="cash-sale-demo-body"
        aria-label={open ? 'Collapse hackathon test controls' : 'Expand hackathon test controls'}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex min-w-0 items-center gap-2">
          <FlaskConical className="cardtrade-demo-label size-4 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="cardtrade-demo-label cardtrade-eyebrow block border-0 bg-transparent px-0 py-0">
              Hackathon · Test Mode
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Simulated payments — not live Stripe
            </span>
          </span>
        </span>
        {open ? (
          <ChevronUp className="cardtrade-demo-label size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="cardtrade-demo-label size-4 shrink-0" aria-hidden />
        )}
      </button>

      {open ? (
        <div id="cash-sale-demo-body" className="space-y-3 px-4 pb-4">
          <p className="text-xs text-muted-foreground">
            In production, Stripe delivers a webhook when the payment clears. Simulate
            that here to advance the sale.
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
              Simulate Stripe failure
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
