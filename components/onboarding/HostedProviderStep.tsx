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
import { HugeiconsIcon } from '@hugeicons/react';
import { ExternalLinkIcon, LoaderCircleIcon, RefreshCwIcon } from '@hugeicons/core-free-icons';

import { beginIdentityCheck, refreshIdentityCheck } from '@/lib/actions/identity';
import { startIdentityVerification, refreshPayoutStatus } from '@/lib/actions/merchant';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface HostedProviderStepProps {
  step: 'identity' | 'payout';
  /** Where the hosted flow returns to. */
  returnPath?: string;
  /** Raised when the hosted/mock flow reports this step complete. */
  onComplete: () => void;
  /**
   * Whether a previous attempt was declined, which changes the label to "Try again".
   *
   * The caller owns this because the verdict comes from the read-back, not from this
   * button: an unchanged "Continue with Stripe" after a refusal is exactly what made a
   * declined document look like a broken page.
   */
  retry?: boolean;
  /**
   * Raised when starting revealed the provider is already reviewing a submission, so
   * there is nowhere to send the member.
   *
   * NOT AN ERROR, AND THAT DISTINCTION IS THE POINT. Reaching this means the document
   * is in, which is the one thing a waiting member wants confirmed — reporting it as
   * "could not open Stripe" turned a working check into an apparent outage.
   */
  onProcessing?: () => void;
}

export function HostedProviderStep({
  step,
  returnPath = '/onboarding',
  onComplete,
  retry = false,
  onProcessing,
}: HostedProviderStepProps) {
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether the message above the button is this member's problem.
   *
   * `notice` covers `provider-unavailable`: NoDitto's own platform setup is
   * incomplete, so nothing the member does changes the outcome. Rendering that in
   * destructive red under a "Continue with Stripe" button told a seller who had just
   * passed their ID check that they had broken something.
   */
  const [tone, setTone] = useState<'error' | 'notice'>('error');
  const [isPending, startTransition] = useTransition();

  function handleContinue() {
    setError(null);
    setTone('error');
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

          // NO LINK IS NOT AUTOMATICALLY A FAULT. Either the provider is mid-review of
          // a document already submitted, or this is the mock with no page to host.
          if (started.data.progress === 'PROCESSING') {
            onProcessing?.();
            return;
          }

          // Mock: there is no hosted page, so read back and report.
          const refreshed = await refreshIdentityCheck();
          if (refreshed.ok && refreshed.data.status === 'VERIFIED') {
            onComplete();
            return;
          }
          if (refreshed.ok && refreshed.data.progress === 'PROCESSING') {
            onProcessing?.();
            return;
          }
          setError('The simulated identity check did not complete. Try again.');
          return;
        }

        const started = await startIdentityVerification(returnPath);
        if (!started.ok) {
          if (started.error === 'provider-unavailable') setTone('notice');
          setError(started.message);
          return;
        }
        if (started.data.url) {
          window.location.assign(started.data.url);
          return;
        }
        // Mock: creating the account was the whole flow. The read-back still runs so
        // the surface reloads against persisted state rather than the click.
        await refreshPayoutStatus();
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
          // `status`, not `alert`, when the platform is the blocker: no error has
          // befallen this member and announcing one is simply inaccurate.
          role={tone === 'notice' ? 'status' : 'alert'}
          className={cn(
            'min-w-0 text-pretty break-words text-body sm:text-right',
            tone === 'notice' ? 'text-muted-foreground' : 'text-destructive',
          )}
        >
          {tone === 'notice' ? (
            <span className="mb-tight block font-medium text-foreground">Waiting on Stripe</span>
          ) : null}
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        onClick={handleContinue}
        disabled={isPending}
        aria-busy={isPending}
        // Demoted once the platform is the blocker: leaving a primary call to action
        // on screen invites a press that cannot succeed.
        variant={tone === 'notice' ? 'outline' : 'default'}
        className="w-full sm:w-auto"
      >
        {isPending ? (
          <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
        ) : (
          <HugeiconsIcon
            icon={tone === 'notice' ? RefreshCwIcon : ExternalLinkIcon}
            className="size-3.5"
            aria-hidden
          />
        )}
        {isPending
          ? 'Opening…'
          : tone === 'notice'
            ? 'Check again'
            : retry
              ? 'Try again'
              : 'Continue with Stripe'}
      </Button>
    </div>
  );
}
