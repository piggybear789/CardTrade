'use client';

// components/identity/IdentityDemoControls.tsx
//
// Demo-only controls for driving a simulated Stripe Identity decision, so the
// Identity_Gate is reachable with `PAYMENTS_PROVIDER=mock`.
//
// WHY IT IS NEEDED. `MockService` lands every check PENDING and never VERIFIED on
// purpose — a mock that auto-verified would let local dev walk through a gate
// production makes you earn, which is the 0060 shape of mistake. With nothing able
// to drive it forward, though, the gate was permanently shut locally: no listing, no
// selling, no trade collateral. This is the crank that turns it, and it fires a signed
// webhook through the real handler rather than writing the column, so the local path
// is the same translate → map → persist path Stripe's own delivery takes.
//
// The server action is gated on `isPaymentDemoEnabled()` and takes no profile id, so
// it cannot fire against a real provider and cannot be aimed at another member. This
// component only renders when the caller says demos are on; the action re-checks
// regardless, because a client-side condition is not a control.

import { useState, useTransition } from 'react';
import { ChevronDown, ChevronUp, FlaskConical, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  fireIdentityWebhook,
  type DemoIdentityWebhookKind,
  type FireIdentityWebhookError,
} from '@/lib/actions/demo';

const ERROR_MESSAGES: Record<FireIdentityWebhookError, string> = {
  unauthenticated: 'Please sign in to use the demo controls.',
  'demo-disabled': 'Mock payment demos are disabled while Stripe is live.',
  'no-check': 'Press "Verify with Stripe" first, then drive the outcome from here.',
  'delivery-failed': 'The simulated webhook could not be delivered.',
  rejected: 'That identity decision could not be applied.',
};

const SUCCESS_MESSAGES: Record<DemoIdentityWebhookKind, string> = {
  verify: 'Identity verified — you can now list, sell, and trade.',
  fail: 'Verification failure delivered — the check can be retried.',
};

export function IdentityDemoControls() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeKind, setActiveKind] = useState<DemoIdentityWebhookKind | null>(null);
  const [isPending, startTransition] = useTransition();

  function fire(kind: DemoIdentityWebhookKind) {
    setActiveKind(kind);
    startTransition(async () => {
      const result = await fireIdentityWebhook(kind);
      if (result.ok) {
        if (result.deduped) {
          toast.info('That webhook was already processed for your profile.');
        } else {
          toast.success(SUCCESS_MESSAGES[kind]);
        }
        // The gate is read server-side, so the card and every gated surface only
        // change on a refetch.
        router.refresh();
      } else {
        toast.error(result.detail ?? ERROR_MESSAGES[result.error]);
      }
      setActiveKind(null);
    });
  }

  const busy = (kind: DemoIdentityWebhookKind) => isPending && activeKind === kind;

  return (
    <section
      className="cardtrade-demo rounded-lg border border-dashed"
      aria-label="Hackathon test mode controls"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="identity-demo-body"
        aria-label={open ? 'Collapse hackathon test controls' : 'Expand hackathon test controls'}
        className="flex w-full items-center justify-between gap-cozy px-group py-cozy text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex min-w-0 items-start gap-snug">
          <FlaskConical className="cardtrade-demo-label mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="cardtrade-demo-label cardtrade-eyebrow block border-0 bg-transparent px-0 py-0">
              Hackathon · Test Mode
            </span>
            <span className="mt-0.5 block text-meta text-muted-foreground">
              Simulated identity check — not live Stripe
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
        <div id="identity-demo-body" className="space-y-cozy px-group pb-group">
          <p className="text-body text-muted-foreground">
            In production, Stripe delivers a webhook once it has checked the document.
            Start a check above, then simulate the decision here.
          </p>
          <div className="flex flex-col gap-snug sm:flex-row">
            <Button
              size="sm"
              onClick={() => fire('verify')}
              disabled={isPending}
              aria-busy={busy('verify')}
            >
              {busy('verify') ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Simulate verified
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => fire('fail')}
              disabled={isPending}
              aria-busy={busy('fail')}
            >
              {busy('fail') ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Simulate failure
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
