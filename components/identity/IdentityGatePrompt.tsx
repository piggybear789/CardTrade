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
import { HugeiconsIcon } from '@hugeicons/react';
import { ExternalLinkIcon, LoaderCircleIcon, ShieldAlertIcon } from '@hugeicons/core-free-icons';

import { beginIdentityCheck, refreshIdentityCheck } from '@/lib/actions/identity';
import { CustodyNote } from '@/components/onboarding/OnboardingSpine';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { type VerificationState } from '@/domain/identity/identityGate';

export interface IdentityGatePromptProps {
  /** Where the member is in verification, read server-side from the gate. */
  state: VerificationState;
  /**
   * Path to come back to after the provider's hosted check, so the member lands where
   * they started rather than on /profile. Must be same-origin.
   */
  returnPath: string;
  /** Called once verification is confirmed complete without leaving the page. */
  onVerified?: () => void;
}

/** Dialog description for a given gate state. Owned here so the header cannot drift. */
export function identityGateDescription(
  state: VerificationState,
  blockedAction: string,
): string {
  switch (state) {
    case 'IN_PROGRESS':
      return `Your check is still open. You cannot ${blockedAction} until it finishes.`;
    case 'NOT_APPROVED':
      return 'That document could not be verified. You can try again.';
    default:
      return `You need a verified identity before you can ${blockedAction}.`;
  }
}

export function IdentityGatePrompt({
  state,
  returnPath,
  onVerified,
}: IdentityGatePromptProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const resuming = state === 'IN_PROGRESS';
  const retrying = state === 'NOT_APPROVED';

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
   * buyer-disclosure consent (Req 4.8-4.12).
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

  const actionLabel = resuming
    ? 'Continue with Stripe'
    : retrying
      ? 'Try again with Stripe'
      : 'Verify with Stripe';

  return (
    <div className="space-y-group">
      {state === 'NOT_STARTED' || resuming ? <IdentityCheckSteps /> : null}

      {retrying ? (
        <p className="flex gap-snug text-body text-destructive">
          <HugeiconsIcon icon={ShieldAlertIcon} className="mt-0.5 size-4 shrink-0" aria-hidden />
          A blurry photo is the usual reason. Take the photos again in good light.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-body text-muted-foreground">{notice}</p> : null}

      <CustodyNote>
        This step opens on Stripe&apos;s pages. NoDitto never sees the document.
      </CustodyNote>

      {/* The action sits in the dialog's footer, where every other dialog puts
          its confirming button, rather than mid-body above a caveat. */}
      <DialogFooter>
        <Button
          type="button"
          onClick={handleStart}
          disabled={isPending}
          aria-busy={isPending}
        >
          {isPending ? (
            <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
          ) : (
            <HugeiconsIcon icon={ExternalLinkIcon} className="size-3.5" aria-hidden />
          )}
          {isPending ? 'Opening Stripe…' : actionLabel}
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * What the hosted check actually asks for. Numbered because the order is real —
 * Stripe takes the document first, then matches a selfie to it.
 */
function IdentityCheckSteps() {
  return (
    <ol className="space-y-cozy">
      <li className="flex items-center gap-cozy">
        <span
          className="grid size-6 shrink-0 place-items-center rounded-full border border-border bg-muted text-meta font-semibold text-muted-foreground"
          aria-hidden
        >
          1
        </span>
        <div className="min-w-0 space-y-tight">
          <p className="text-body font-medium text-foreground">Photo ID</p>
          <p className="text-body leading-relaxed text-muted-foreground">
            A government document. Stripe may ask for the front and back.
          </p>
        </div>
      </li>
      <li className="flex items-center gap-cozy">
        <span
          className="grid size-6 shrink-0 place-items-center rounded-full border border-border bg-muted text-meta font-semibold text-muted-foreground"
          aria-hidden
        >
          2
        </span>
        <div className="min-w-0 space-y-tight">
          <p className="text-body font-medium text-foreground">Matching selfie</p>
          <p className="text-body leading-relaxed text-muted-foreground">
            Taken in the same flow, so the face matches the ID.
          </p>
        </div>
      </li>
    </ol>
  );
}
