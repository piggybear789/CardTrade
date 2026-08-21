'use client';

// components/onboarding/HostedProviderStep.tsx
//
// The provider-hosted leg of onboarding: it drives the hosted/mock flow through the
// SAME seam methods (Req 10.3) and says plainly that the step continues on Stripe's
// pages (Req 10.4).
//
// IT IS THE PRIMARY SURFACE FOR PAYOUTS, AND A FALLBACK FOR IDENTITY. It was named
// `ProviderFallbackStep` when it only covered providers with no embedded components
// (Req 10.1) — the Mock, or any non-embedded binding. The payout step now routes here
// by default: Connect's embedded onboarding renders its own headings, typography and
// buttons, and inside our dialog that read as a second product wearing our chrome. On
// Stripe's own pages nobody expects it to match, and the prefill is unaffected because
// it lives on the ACCOUNT rather than on whichever surface collects the rest.
//
// Renders no heading of its own — the surface owns the step title.

import { useState, useTransition } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { beginIdentityCheck, refreshIdentityCheck } from '@/lib/actions/identity';
import { startIdentityVerification, refreshPayoutStatus } from '@/lib/actions/merchant';
import { Button } from '@/components/ui/button';

export interface HostedProviderStepProps {
  step: 'identity' | 'payout';
  /** Where the hosted flow returns to. */
  returnPath?: string;
  /** Raised when the hosted/mock flow reports this step complete. */
  onComplete: () => void;
}

export function HostedProviderStep({
  step,
  returnPath = '/onboarding',
  onComplete,
}: HostedProviderStepProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleContinue() {
    setError(null);
    startTransition(async () => {
      try {
        if (step === 'identity') {
          const started = await beginIdentityCheck(returnPath);
          if (!started.ok) {
            setError(started.message);
            return;
          }
          if (started.data.url) {
            // Hosted provider: full navigation, the destination is off-origin.
            window.location.assign(started.data.url);
            return;
          }
          // Mock: there is no hosted page, so read back and report.
          const refreshed = await refreshIdentityCheck();
          if (refreshed.ok && refreshed.data.status === 'VERIFIED') {
            toast.success('Identity verified');
            onComplete();
            return;
          }
          setError('The simulated identity check did not complete. Try again.');
          return;
        }

        const started = await startIdentityVerification(returnPath);
        if (!started.ok) {
          setError(started.message);
          return;
        }
        if (started.data.url) {
          window.location.assign(started.data.url);
          return;
        }
        // Mock: creating the account was the whole flow.
        const refreshed = await refreshPayoutStatus();
        if (refreshed.ok && refreshed.data.settlementsEnabled) {
          toast.success('Payouts active');
        } else {
          toast.success('Payout setup submitted');
        }
        onComplete();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not open Stripe. Check your connection and try again.',
        );
      }
    });
  }

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-snug sm:max-w-xs sm:items-end">
      {error ? (
        <p
          role="alert"
          className="min-w-0 text-pretty break-words text-body leading-relaxed text-destructive sm:text-right"
        >
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        onClick={handleContinue}
        disabled={isPending}
        aria-busy={isPending}
        className="w-full sm:w-auto"
      >
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <ExternalLink className="size-3.5" aria-hidden />
        )}
        {isPending ? 'Opening…' : 'Continue with Stripe'}
      </Button>
    </div>
  );
}
