'use client';

// components/trade/DemoPanel.tsx
//
// The Trade Contract "Demo" panel (task 15.3). A clearly-labelled, collapsible
// panel that fires SIMULATED Pinch webhooks into the real Webhook_Handler,
// exercising the exact code path a live Pinch webhook would (Req 10.1).
//
// In this frontend-first MVP the payment provider is mocked, so the collateral
// pre-auth confirmation that advances a Trade COLLATERAL_PENDING ->
// COLLATERAL_LOCKED (Req 5.5) - and the failure that would cancel it (Req 5.6)
// - never arrive from a real provider. This panel lets a demo operator deliver
// them on demand. Shipping/receipt/acceptance/dispute/fraud (Req 6.2, 6.4, 6.6,
// 7.1, 8.1) are real participant actions surfaced by the ActionBar, so the panel
// deliberately covers only the PAYMENT/COLLATERAL webhooks.
//
// The signing happens server-side (the shared secret must never reach the
// browser), so each control calls the `fireTradeWebhook` server action via
// useTransition. The action only DELIVERS the webhook; the resulting
// Trade_State transition is committed by the handler and flows back into the
// view over the existing realtime subscription, so this panel never refetches.
// Outcomes are surfaced with sonner toasts.

import { useState, useTransition } from 'react';
import { ChevronDown, ChevronUp, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  fireTradeWebhook,
  type DemoWebhookKind,
  type FireTradeWebhookError,
} from '@/lib/actions/demo';

/** Human-readable messages for the demo-action error codes. */
const ERROR_MESSAGES: Record<FireTradeWebhookError, string> = {
  unauthenticated: 'Please sign in to use the demo controls.',
  'not-participant': 'Only participants in this trade can use the demo controls.',
  'delivery-failed': 'The simulated webhook could not be delivered.',
  rejected: 'This trade cannot accept that event in its current state.',
};

/** Success copy per control. */
const SUCCESS_MESSAGES: Record<DemoWebhookKind, string> = {
  'confirm-holds': 'Collateral holds confirmed - the trade advances to Collateral Locked.',
  'fail-holds': 'Collateral hold failure delivered.',
};

export interface DemoPanelProps {
  /** The Trade this panel fires simulated webhooks for. */
  tradeId: string;
}

/**
 * Collapsible demo control panel. Renders a labelled toggle and, when expanded,
 * the set of simulated-webhook controls.
 */
export function DemoPanel({ tradeId }: DemoPanelProps) {
  const [open, setOpen] = useState(false);
  // Track which control is mid-flight so only that button shows a busy state.
  const [activeKind, setActiveKind] = useState<DemoWebhookKind | null>(null);
  const [isPending, startTransition] = useTransition();

  function fire(kind: DemoWebhookKind) {
    setActiveKind(kind);
    startTransition(async () => {
      const result = await fireTradeWebhook(tradeId, kind);
      if (result.ok) {
        if (result.deduped) {
          toast.info('That webhook was already processed for this trade.');
        } else {
          toast.success(SUCCESS_MESSAGES[kind]);
        }
      } else {
        toast.error(result.detail ?? ERROR_MESSAGES[result.error]);
      }
      setActiveKind(null);
    });
  }

  const busy = (kind: DemoWebhookKind) => isPending && activeKind === kind;

  return (
    <section
      className="rounded-lg border border-dashed border-amber-500/50 bg-amber-500/5"
      aria-label="Demo controls"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="demo-panel-body"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <FlaskConical className="size-4 text-amber-600" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">
            Demo controls
          </span>
        </span>
        {open ? (
          <ChevronUp className="size-4 text-amber-600" aria-hidden />
        ) : (
          <ChevronDown className="size-4 text-amber-600" aria-hidden />
        )}
      </button>

      {open ? (
        <div id="demo-panel-body" className="space-y-4 px-4 pb-4">
          <p className="text-sm text-muted-foreground">
            Payments are simulated in this build. These controls fire the
            collateral webhooks Pinch would otherwise deliver, exercising the
            real webhook code path. Shipping, receipt, acceptance, disputes, and
            fraud are handled by your actions above.
          </p>

          <div className="space-y-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={() => fire('confirm-holds')}
                  disabled={isPending}
                  aria-busy={busy('confirm-holds')}
                  className="flex-1"
                >
                  Confirm collateral holds
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => fire('fail-holds')}
                  disabled={isPending}
                  aria-busy={busy('fail-holds')}
                  className="flex-1"
                >
                  Fail collateral holds
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Confirming advances Collateral Pending → Collateral Locked;
                failing cancels the pending collateral.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
