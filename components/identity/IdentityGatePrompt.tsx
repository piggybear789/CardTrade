'use client';

// components/identity/IdentityGatePrompt.tsx
//
// Unblock a gated action from wherever the member was stopped, instead of sending
// them to /profile to find the setup card.
//
// WHY THIS EXISTS. Gated actions used to render a DISABLED control plus a sentence of
// explanation. That is a dead end: the control that names the thing the member wants
// is the control that cannot be pressed, and the copy explaining why is not
// clickable. This lets the blocked action stay pressable and answer the click with
// the one step that unblocks it.
//
// WAS `components/payouts/PayoutSetupPrompt.tsx`, AND THE RENAME IS THE POINT. It
// took a `VerificationState` — so it was rendered for members blocked by the
// Identity_Gate — but the button it offered opened Connect payout onboarding. After
// 0069 that no longer moves the gate at all, so a blocked member would have been
// asked for their bank details and then still been blocked. The prompt has to offer
// the step that actually unblocks the thing they clicked.
//
// It does NOT weaken the gate. `proposeTradeAction` (Req 14.2, 14.6) and the
// orchestrators still refuse on their own reading of the gate — this only changes
// which surface asks, and it asks BEFORE the member fills in a form that would be
// rejected on submit.
//
// The buyer-disclosure consent (Req 4.8-4.12) is collected here for the same reason
// it is collected at onboarding: it cannot be assumed from a click on "Propose
// Trade". Nothing sensitive is gathered — the provider collects the document itself.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';

import { beginIdentityCheck, refreshIdentityCheck } from '@/lib/actions/identity';
import { Button } from '@/components/ui/button';
import { type VerificationState } from '@/domain/identity/identityGate';

export interface IdentityGatePromptProps {
  /** Where the member is in verification, read server-side from the gate. */
  state: VerificationState;
  /**
   * What they were trying to do, as a verb phrase — "start a trade". Used in the one
   * line of explanation so the prompt reads as an answer to their click.
   */
  blockedAction: string;
  /**
   * Path to come back to after the provider's hosted check, so the member lands where
   * they started rather than on /profile. Must be same-origin.
   */
  returnPath: string;
  /** Called once verification is confirmed complete without leaving the page. */
  onVerified?: () => void;
}

export function IdentityGatePrompt({
  state,
  blockedAction,
  returnPath,
  onVerified,
}: IdentityGatePromptProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const resuming = state === 'IN_PROGRESS';

  /**
   * Re-read the provider's own answer and let the caller react to it.
   *
   * THE IDENTITY_GATE, not payout readiness. Since 0069 they are separate steps and a
   * member can hold either without the other, so reading the wrong one here would
   * either keep a verified member blocked or wave through someone who only added a
   * bank account.
   */
  async function settle(pendingMessage: string) {
    const refreshed = await refreshIdentityCheck();
    router.refresh();
    if (refreshed.ok && refreshed.data.status === 'VERIFIED') {
      onVerified?.();
      return;
    }
    setNotice(pendingMessage);
  }

  /**
   * Create the check and leave for the provider in one action. Pressing this is the
   * buyer-disclosure consent (Req 4.8-4.12), stated beneath it.
   */
  function handleStart() {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const started = await beginIdentityCheck(returnPath);
      if (!started.ok) {
        setError(started.message);
        return;
      }
      if (started.data.url) {
        // Full navigation, not a router push: the destination is off-origin.
        window.location.assign(started.data.url);
        return;
      }
      // No hosted flow (MockService): fall back to reading whatever state exists.
      await settle('Still checking — we will update this automatically.');
    });
  }

  function handleRecheck() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      await settle('Still checking — we will update this automatically.');
    });
  }

  return (
    <div className="space-y-group">
      <div className="space-y-tight">
        <p className="text-body text-muted-foreground">
          {resuming
            ? `Your identity check is not finished yet, so you cannot ${blockedAction} for the moment. Continue when you are ready.`
            : `Verify your identity to ${blockedAction}. It takes one step and needs a photo ID — no bank details.`}
        </p>
        {state === 'NOT_APPROVED' ? (
          <p className="flex gap-snug text-body text-destructive">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {/* Retryable. A document check fails for a blurry photo far more often
                than for anything sinister. */}
            That document could not be verified. You can try again.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-snug">
        <Button type="button" onClick={handleStart} disabled={isPending} aria-busy={isPending}>
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <BadgeCheck className="size-3.5" aria-hidden />
          )}
          {resuming ? 'Continue with Stripe' : 'Verify with Stripe'}
        </Button>
        {resuming ? (
          <Button variant="outline" onClick={handleRecheck} disabled={isPending}>
            <RefreshCw className="size-3.5" aria-hidden />
            Check status
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-body text-muted-foreground">{notice}</p> : null}

      {/* Req 4.8-4.12: continuing is the consent, so it is stated here. */}
      <p className="text-body text-muted-foreground">
        Stripe checks a photo ID and a selfie on its own pages — NoDitto never sees the
        document. You agree that the name on it can be shown to someone you have an
        agreed sale or trade with.
      </p>
    </div>
  );
}
