'use client';

// components/trade/DemoPanel.tsx
//
// The Trade Contract "Demo" panel (task 15.3). A clearly-labelled, collapsible
// panel that fires SIMULATED Pinch webhooks into the real Webhook_Handler,
// exercising the exact code path a live Pinch webhook would (Req 10.1).
//
// Collapsed by default and labelled as hackathon / test mode so judges never
// mistake these buttons for production payment steps.

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
  'demo-disabled': 'Mock payment demos are disabled while Pinch is live.',
  rejected: 'This trade cannot accept that event in its current state.',
};

/** Success copy per control. */
const SUCCESS_MESSAGES: Record<DemoWebhookKind, string> = {
  'confirm-holds': 'Collateral holds confirmed — the trade advances to Collateral Locked.',
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
      className="cardtrade-demo rounded-lg border border-dashed"
      aria-label="Hackathon test mode controls"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="demo-panel-body"
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
              Simulated payments — not live Pinch
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
