'use client';

// components/payouts/PayoutSetupPrompt.tsx
//
// Start (or resume) Identity_Gate verification from wherever the member was
// blocked, instead of sending them to /profile to find the setup card.
//
// WHY THIS EXISTS. Gated actions used to render a DISABLED control plus a
// sentence of explanation. That is a dead end: the control that names the thing
// the member wants is the control that cannot be pressed, and the copy explaining
// why is not clickable. This component lets the blocked action stay pressable and
// answer the click with the one step that unblocks it.
//
// It does NOT weaken the gate. `proposeTradeAction` (Req 14.2, 14.6) and the
// orchestrators still refuse on their own reading of the gate — this only changes
// which surface asks for verification, and it asks BEFORE the member fills in a
// form that would be rejected on submit.
//
// The buyer-disclosure consent (Req 4.8-4.12) is collected here for the same
// reason it is collected on /profile: it cannot be assumed from a click on
// "Propose Trade". Only the consent flag and an optional shop name are gathered;
// everything sensitive is collected by the provider on its own pages.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, ExternalLink, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';

import {
  createPayoutOnboardingLink,
  refreshPayoutStatus,
  startIdentityVerification,
} from '@/lib/actions/merchant';
import { Button } from '@/components/ui/button';
import {
  satisfiesIdentityGate,
  type VerificationState,
} from '@/domain/identity/identityGate';

export interface PayoutSetupPromptProps {
  /** Where the member is in verification, read server-side from the gate. */
  state: VerificationState;
  /**
   * What they were trying to do, as a verb phrase — "start a trade". Used in the
   * one line of explanation so the prompt reads as an answer to their click.
   */
  blockedAction: string;
  /**
   * Path to come back to after the provider's hosted flow, so the member lands
   * where they started rather than on /profile. Must be same-origin.
   */
  returnPath: string;
  /** Called once verification is confirmed complete without leaving the page. */
  onVerified?: () => void;
}

export function PayoutSetupPrompt({
  state,
  blockedAction,
  returnPath,
  onVerified,
}: PayoutSetupPromptProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const resuming = state === 'IN_PROGRESS';

  /**
   * Send the member off to the provider. A provider with no hosted flow (the
   * MockService) reports `not-supported` rather than throwing, in which case the
   * submission alone is the whole flow and we re-read the resulting status.
   */
  async function openHostedFlow(): Promise<'redirecting' | 'settled' | 'failed'> {
    const link = await createPayoutOnboardingLink(returnPath);
    if (link.ok) {
      // Full navigation, not a router push: the destination is off-origin.
      window.location.assign(link.data.url);
      return 'redirecting';
    }
    if (link.error !== 'not-supported') {
      setError(link.message);
      return 'failed';
    }
    return 'settled';
  }

  /**
   * Re-read the provider's own answer and let the caller react to it. The gate is
   * evaluated with `satisfiesIdentityGate`, never re-derived here — a second
   * definition of "verified" is the bug this module exists downstream of.
   */
  async function settle(successMessage: string) {
    const refreshed = await refreshPayoutStatus();
    router.refresh();
    if (
      refreshed.ok &&
      satisfiesIdentityGate({
        merchantStatus: refreshed.data.merchantStatus,
        settlementsEnabled: refreshed.data.settlementsEnabled,
      })
    ) {
      onVerified?.();
      return;
    }
    setNotice(successMessage);
  }

  /**
   * Create the Connect account and leave for the provider in one action. Pressing
   * this is the buyer-disclosure consent (Req 4.8-4.12), stated beneath it.
   */
  function handleStart() {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const started = await startIdentityVerification(returnPath);
      if (!started.ok) {
        setError(started.message);
        return;
      }
      if (started.data.url) {
        // Full navigation, not a router push: the destination is off-origin.
        window.location.assign(started.data.url);
        return;
      }
      // No hosted flow (MockService): the account creation was the whole flow.
      await settle('Still verifying — we will update this automatically.');
    });
  }

  function handleResume() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const outcome = await openHostedFlow();
      if (outcome === 'settled') await settle('Still verifying — we will update this automatically.');
    });
  }

  function handleRecheck() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      await settle('Still verifying — we will update this automatically.');
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-sm text-muted-foreground">
          {resuming
            ? `Your Stripe Connect setup is not finished yet, so you cannot ${blockedAction} for the moment. Continue when you are ready.`
            : `Complete Stripe Connect payout setup to ${blockedAction}. A trade can pay one side money if something goes wrong, so payouts must be active first.`}
        </p>
        {state === 'NOT_APPROVED' ? (
          <p className="flex gap-2 text-sm text-destructive">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            Verification did not pass last time. You can start again.
          </p>
        ) : null}
      </div>

      {resuming ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleResume} disabled={isPending} aria-busy={isPending}>
            {isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <ExternalLink className="size-3.5" aria-hidden />
            )}
            Continue with Stripe
          </Button>
          <Button variant="outline" onClick={handleRecheck} disabled={isPending}>
            <RefreshCw className="size-3.5" aria-hidden />
            Check status
          </Button>
        </div>
      ) : (
        <Button type="button" onClick={handleStart} disabled={isPending} aria-busy={isPending}>
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <BadgeCheck className="size-3.5" aria-hidden />
          )}
          Verify with Stripe
        </Button>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      {/* Req 4.8-4.12: continuing is the consent, so it is stated here. */}
      <p className="text-xs text-muted-foreground">
        Stripe collects your payout and bank details on its own pages — NoDitto never sees
        them. You agree that the payout name Stripe reports can be shown to someone you
        have an agreed sale or trade with.
      </p>
    </div>
  );
}
