'use client';

// components/onboarding/UnifiedOnboardingSurface.tsx
//
// The single NoDitto page that owns BOTH onboarding steps (unified-seller-onboarding,
// Req 1). Identity first, then payouts, on one vertical spine: the active step expands,
// a finished one collapses to a confirmed line.
//
// IDENTITY IS INLINE, PAYOUTS ARE HOSTED. Identity is a Stripe.js modal, which reads as
// part of the app. Payouts leave for Stripe's own pages and come back to this same
// spine — Connect's embedded onboarding brings its own headings, type and buttons, and
// inside our dialog that looked like a different product wearing our chrome. Req 5
// specified embedded for this step; that is a deliberate, recorded divergence, and the
// `EmbeddedPayoutStep` component is still in the tree if it is ever revisited.
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ArrowRight } from 'lucide-react';

import { getIdentityCheckState } from '@/lib/actions/identity';
import { getMerchantState } from '@/lib/actions/merchant';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmbeddedIdentityStep } from './EmbeddedIdentityStep';
import { OnboardingSpine, OnboardingSpineStep } from './OnboardingSpine';
import { HostedProviderStep } from './HostedProviderStep';

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
}

export function UnifiedOnboardingSurface({
  returnPath = '/onboarding',
  onComplete,
  onSettledChange,
}: UnifiedOnboardingSurfaceProps) {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [identityDone, setIdentityDone] = useState(false);
  const [payoutDone, setPayoutDone] = useState(false);
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Set when the provider reports no embedded Identity binding, so that step falls back
  // to the hosted flow. The payout step needs no flag: it is hosted either way.
  const [identityFallback, setIdentityFallback] = useState(false);

  const settledChange = useRef(onSettledChange);
  settledChange.current = onSettledChange;

  // Resume from the authoritative read-back rather than assuming a fresh start
  // (Req 13.3). Both reads are independent, matching the two independent gates.
  const load = useCallback(async () => {
    setLoadError(false);
    const [identity, merchant] = await Promise.all([
      getIdentityCheckState(),
      getMerchantState(),
    ]);

    if (!identity.ok && !merchant.ok) {
      setLoadError(true);
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
    else router.push('/listings');
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

  return (
    <div className="space-y-group">
      <OnboardingSpine>
        <OnboardingSpineStep
          index={1}
          state={identityDone ? 'done' : 'active'}
          title="Verify your identity"
          description="Photo ID and a selfie, checked by Stripe."
          receipt={verifiedName ? `Verified as ${verifiedName}` : 'Verified'}
          hasNext
        >
          {identityFallback ? (
            <HostedProviderStep
              step="identity"
              returnPath={returnPath}
              onComplete={finishIdentity}
            />
          ) : (
            <EmbeddedIdentityStep
              returnPath={returnPath}
              onVerified={finishIdentity}
              onUnsupported={() => setIdentityFallback(true)}
            />
          )}
        </OnboardingSpineStep>

        <OnboardingSpineStep
          index={2}
          state={payoutDone ? 'done' : identityDone ? 'active' : 'upcoming'}
          title="Add payout details"
          description={
            identityDone
              ? 'Where your sales are paid out.'
              : 'Available once your identity is verified.'
          }
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

      {/* The two gates are independent, so say so at the moment it matters: a verified
          seller with no payout account can already trade. Without this the outstanding
          second step reads as a blocker on everything. */}
      {/* A FINISHED WIZARD NEEDS A WAY FORWARD, NOT A NOTICE. Returning from Stripe with
          both steps already done landed on a bordered "You're set up." box whose most
          prominent control was "Back" — a dead end dressed as a confirmation. The spine
          above already shows both ticks, so this is just the exit. */}
      {bothDone ? (
        <Button type="button" onClick={finishPayout} className="w-full">
          Start listing
          <ArrowRight className="ml-2 size-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
