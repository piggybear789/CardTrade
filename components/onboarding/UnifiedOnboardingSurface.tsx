'use client';

// components/onboarding/UnifiedOnboardingSurface.tsx
//
// The single definition of BOTH onboarding steps (unified-seller-onboarding, Req 1).
// Identity first, then payouts, on one vertical spine: the active step expands, a
// finished one collapses to a confirmed line. Because only the ACTIVE step renders its
// control, a sequence of two gates is always exactly one button.
//
// TWO CALLERS, ONE SEQUENCE. The signup wizard (`OnboardingWizard`) and the settings
// Verification tab (`VerificationSequence`) both mount this. Settings used to carry its
// own pair of cards instead, which offered both buttons at once for steps that are
// strictly ordered — the "two answers to one question" failure the rest of this flow is
// commented against. What differs per caller is passed in: where the hosted flows
// return to, and what (if anything) to offer once both ticks are in.
//
// BOTH STEPS ARE HOSTED. This surface can live inside the onboarding Dialog. Stripe's
// Identity modal (`stripe.verifyIdentity`) cannot open there: Radix marks everything
// outside the dialog inert and traps focus, so the session is created, the Stripe UI
// never paints, and the click looks like a no-op. Payouts already leave for Stripe's
// own pages for the same reason (Connect embedded chrome plus the dialog). Identity
// follows that path — which is also why this surface is portable to a plain page at
// all. `EmbeddedIdentityStep` / `EmbeddedPayoutStep` stay in the tree for a non-dialog
// surface.
//
// THE TWO GATES STAY INDEPENDENT. This unifies the UI only. Identity status comes from
// `getIdentityCheckState` (the Identity_Gate input) and payout status from
// `getMerchantState` (the payout input); they are read, rendered and completed
// separately, and a verified seller with no payout account is a valid resting state
// (Req 1.6, 8.3) — which is why the surface tells them plainly that they can already
// list and sell while payouts are outstanding.
//
// The buyer-disclosure consent (Req 11) is carried by starting the identity check and
// is stated by the caller next to that control, matching the prior flow.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';

import { getIdentityCheckState } from '@/lib/actions/identity';
import { getMerchantState } from '@/lib/actions/merchant';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { OnboardingSpine, OnboardingSpineStep } from './OnboardingSpine';
import { HostedProviderStep } from './HostedProviderStep';

/** Both gates as a caller already knows them, for {@link UnifiedOnboardingSurfaceProps.initialStatus}. */
export interface OnboardingStatusSnapshot {
  identityDone: boolean;
  payoutDone: boolean;
  verifiedName: string | null;
}

export interface UnifiedOnboardingSurfaceProps {
  /** Where the resumable/hosted flows return to. */
  returnPath?: string;
  /** Raised when both steps are complete. Defaults to routing to the catalog. */
  onComplete?: () => void;
  /**
   * Reports whether BOTH steps are already satisfied, so the surrounding wizard can
   * drop the controls that only make sense while something is outstanding. Called on
   * every status read, not only on the transition, because a member returning from the
   * provider arrives with the work already done.
   */
  onSettledChange?: (bothDone: boolean) => void;
  /**
   * The same two gates as a server render already read them, so a page that HAS the
   * answer does not open on a skeleton and then resolve to what it already knew.
   *
   * It decides the first paint and nothing else: the mount read below still runs and
   * still wins, because a snapshot taken during a server render says nothing about a
   * check the provider finished a moment later.
   */
  initialStatus?: OnboardingStatusSnapshot;
  /**
   * The way onward once both steps are complete. Onboarding is a wizard, so it needs
   * an exit; a caller that is ALREADY the destination passes `null` and lets the two
   * ticks on the spine be the whole confirmation.
   */
  completion?: ReactNode;
}

export function UnifiedOnboardingSurface({
  returnPath = '/onboarding',
  onComplete,
  onSettledChange,
  initialStatus,
  completion,
}: UnifiedOnboardingSurfaceProps) {
  const router = useRouter();
  const [loaded, setLoaded] = useState(initialStatus !== undefined);
  const [identityDone, setIdentityDone] = useState(initialStatus?.identityDone ?? false);
  const [payoutDone, setPayoutDone] = useState(initialStatus?.payoutDone ?? false);
  const [verifiedName, setVerifiedName] = useState<string | null>(
    initialStatus?.verifiedName ?? null,
  );
  const [loadError, setLoadError] = useState(false);

  const settledChange = useRef(onSettledChange);
  settledChange.current = onSettledChange;

  // Whether the first paint came from a server read. A refresh that then fails must
  // not blank a spine already showing something true — the seed is seconds old and
  // every control on it re-validates server-side before it does anything.
  const seeded = useRef(initialStatus !== undefined);

  // Resume from the authoritative read-back rather than assuming a fresh start
  // (Req 13.3). Both reads are independent, matching the two independent gates.
  const load = useCallback(async () => {
    setLoadError(false);
    const [identity, merchant] = await Promise.all([
      getIdentityCheckState(),
      getMerchantState(),
    ]);

    if (!identity.ok && !merchant.ok) {
      if (!seeded.current) setLoadError(true);
      setLoaded(true);
      return;
    }

    const identityOk = identity.ok && identity.data.status === 'VERIFIED';
    const payoutOk = merchant.ok && merchant.data.settlementsEnabled;

    setIdentityDone(identityOk);
    setVerifiedName(identity.ok ? identity.data.verifiedName : null);
    setPayoutDone(payoutOk);
    setLoaded(true);
    // Read through a ref so `load` stays referentially stable. An inline arrow from the
    // caller would otherwise change identity every render, changing `load`, re-firing
    // the effect below, and turning one status read into an endless loop of them.
    settledChange.current?.(identityOk && payoutOk);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function finishIdentity() {
    setIdentityDone(true);
    void load();
  }

  function finishPayout() {
    setPayoutDone(true);
    if (onComplete) onComplete();
    else router.push('/');
  }

  if (!loaded) {
    // SHAPED LIKE THE SPINE IT REPLACES: two marker-plus-text rows at the same widths
    // and heights. The previous skeleton was three unrelated bars roughly a third of
    // the loaded height, so resolving it resized the dialog and the whole panel moved.
    return (
      <div className="space-y-section" role="status" aria-label="Loading your setup">
        {[0, 1].map((row) => (
          <div key={row} className="grid grid-cols-[auto_1fr] gap-x-group">
            <Skeleton className="size-7 rounded-full" />
            <div className="space-y-tight">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
              {row === 1 ? <Skeleton className="mt-group h-10 w-44" /> : null}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-cozy">
        <p role="alert" className="text-body leading-relaxed text-destructive">
          We couldn&apos;t load your setup status. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="text-body font-medium underline underline-offset-2 hover:text-foreground"
        >
          Retry
        </button>
      </div>
    );
  }

  const bothDone = identityDone && payoutDone;
  const exit =
    completion === undefined ? (
      <Button type="button" onClick={finishPayout} className="w-full">
        Start listing
        <HugeiconsIcon icon={ArrowRight01Icon} className="ml-2 size-4" aria-hidden />
      </Button>
    ) : (
      completion
    );

  return (
    <div className="space-y-group">
      <OnboardingSpine>
        <OnboardingSpineStep
          index={1}
          state={identityDone ? 'done' : 'active'}
          title="Verify your identity"
          description="We verify your identity to block known fraudsters from selling on the platform."
          receipt={verifiedName ? `Verified as ${verifiedName}` : 'Verified'}
          hasNext
        >
          <HostedProviderStep
            step="identity"
            returnPath={returnPath}
            onComplete={finishIdentity}
          />
        </OnboardingSpineStep>

        <OnboardingSpineStep
          index={2}
          state={payoutDone ? 'done' : identityDone ? 'active' : 'upcoming'}
          title="Add payout details"
          // CONSTANT, because the spine already branches on state for us: a done step
          // renders `receipt` and never this. Making it conditional on `identityDone`
          // put "Payout details confirmed" under an UNTICKED step two whenever identity
          // was still outstanding — the description contradicting the marker beside it,
          // on the first thing an unverified member sees.
          description="Add your payout details to receive your funds."
          receipt="Payouts active"
          hasNext={false}
        >
          {/* HOSTED, not embedded. The spine, the numbering and the return here are all
              still ours; only the form Stripe insists on owning happens on Stripe. See
              `HostedProviderStep` for why. The prefill is unaffected — it is written to
              the account at creation, so the hosted pages open already filled in. */}
          <HostedProviderStep
            step="payout"
            returnPath={returnPath}
            onComplete={finishPayout}
          />
        </OnboardingSpineStep>
      </OnboardingSpine>

      {/* A FINISHED WIZARD NEEDS A WAY FORWARD, NOT A NOTICE. Returning from Stripe with
          both steps already done landed on a bordered "You're set up." box whose most
          prominent control was "Back" — a dead end dressed as a confirmation. The spine
          above already shows both ticks, so this is just the exit.

          Which is why it is overridable rather than fixed: "Start listing" is the right
          answer for a wizard the member is trying to leave, and the wrong one on a
          settings tab they deliberately opened. That caller passes `null`. */}
      {bothDone ? exit : null}
    </div>
  );
}
