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
  submitMerchantOnboarding,
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
  const [consent, setConsent] = useState(false);
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

  function handleStart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!consent) {
      setError('Buyers must be able to see who they are paying, so this is required.');
      return;
    }

    startTransition(async () => {
      const submitted = await submitMerchantOnboarding({ buyerDisclosureConsent: true });
      // A second click after a successful submission should resume, not fail.
      if (!submitted.ok && submitted.error !== 'already-onboarded') {
        setError(submitted.message);
        return;
      }
      const outcome = await openHostedFlow();
      if (outcome === 'settled') {
        await settle('Verification submitted. We will update this as soon as it completes.');
      }
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
            ? `Your verification is not finished yet, so you cannot ${blockedAction} for the moment. Pick up where you left off.`
            : `Verify yourself once and you can ${blockedAction}. A trade can pay one side money if something goes wrong, so we need somewhere to send it.`}
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
            Finish verification
          </Button>
          <Button variant="outline" onClick={handleRecheck} disabled={isPending}>
            <RefreshCw className="size-3.5" aria-hidden />
            Check status
          </Button>
        </div>
      ) : (
        <form onSubmit={handleStart} className="space-y-3">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              name="buyerDisclosureConsent"
              className="mt-0.5 size-4 shrink-0"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              disabled={isPending}
            />
            <span className="text-muted-foreground">
              I agree that the people I trade with can see my verified name.
            </span>
          </label>

          <Button type="submit" disabled={isPending} aria-busy={isPending}>
            {isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <BadgeCheck className="size-3.5" aria-hidden />
            )}
            Verify my identity
          </Button>
        </form>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      <p className="text-xs text-muted-foreground">
        You will be taken to our payment provider to confirm your identity and bank
        account, then brought straight back here. NoDitto never sees your bank
        details.
      </p>
    </div>
  );
}
