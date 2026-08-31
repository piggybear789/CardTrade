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
// EVERY MOUNT RECONCILES AGAINST THE PROVIDER. `getIdentityCheckState` and
// `getMerchantState` read our own columns, which a webhook writes — and a member
// returning from Stripe arrives before that webhook does, so those reads paint the
// first frame and decide nothing. `reconcile` below then asks Stripe directly and, for
// identity, keeps asking while the session is still under review. Without it a passing
// check and an untouched one render identically, which is exactly what shipped.
//
// THE TWO GATES STAY INDEPENDENT. This unifies the UI only. Identity status comes from
// the Identity_Gate input and payout status from the payout input; they are read,
// rendered and completed separately, and a verified seller with no payout account is a
// valid resting state
// (Req 1.6, 8.3) — which is why the surface tells them plainly that they can already
// list and sell while payouts are outstanding.
//
// The buyer-disclosure consent (Req 11) is carried by starting the identity check and
// is stated by the caller next to that control, matching the prior flow.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, LoaderCircleIcon } from '@hugeicons/core-free-icons';

import { getIdentityCheckState, refreshIdentityCheck } from '@/lib/actions/identity';
import { getMerchantState, refreshPayoutStatus } from '@/lib/actions/merchant';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { OnboardingSpine, OnboardingSpineStep } from './OnboardingSpine';
import { HostedProviderStep } from './HostedProviderStep';

/**
 * How long to keep asking Stripe for a verdict, and how the gaps grow.
 *
 * Sized from observed provider behaviour: a document session moves
 * `created -> processing -> verified` in roughly seven seconds. A member is back on
 * this page one or two seconds after submitting, so a SINGLE read on return lands on
 * PENDING every single time — which is precisely how a passing check came to look
 * like a broken page offering the same button forever.
 *
 * Totals a little over forty seconds across eight reads, then stops and says so.
 * Stopping matters: a manual review can take minutes, and a spinner that never ends
 * is a worse answer than "we are still waiting, come back".
 */
const REVIEW_POLL_DELAYS_MS = [1_500, 2_500, 3_500, 5_000, 7_000, 9_000, 12_000];

/** Shown when the provider declined but gave us no sentence of its own. */
const DECLINED_WITHOUT_REASON =
  'Stripe could not verify that document. You can try again with a different one.';

/** Shown when the poll budget runs out with the session still under review. */
const STILL_UNDER_REVIEW =
  'Stripe is still reviewing your document. This can take a few minutes — reload this page to check again.';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  /** True only while a real session is known to be mid-review at the provider. */
  const [identityChecking, setIdentityChecking] = useState(false);
  /** The provider's verdict, or our own note that it has not delivered one yet. */
  const [identityProblem, setIdentityProblem] = useState<string | null>(null);

  const settledChange = useRef(onSettledChange);
  settledChange.current = onSettledChange;

  // Which poll run owns the component. Bumped on every mount AND every unmount, so an
  // in-flight poll can tell that it has been superseded and stop writing.
  //
  // A boolean would not survive StrictMode's mount/unmount/mount in development: the
  // cleanup clears it, the second mount sets it again, and the FIRST poll — still
  // sleeping between reads — wakes up believing it is current and runs a duplicate
  // sequence of provider calls alongside the real one.
  const runId = useRef(0);

  // Whether the first paint came from a server read. A refresh that then fails must
  // not blank a spine already showing something true — the seed is seconds old and
  // every control on it re-validates server-side before it does anything.
  const seeded = useRef(initialStatus !== undefined);

  // Our own columns, no provider round trip. Fast enough to paint against, but NOT
  // authoritative: they are written by a webhook, and a member returning from Stripe
  // beats that webhook nearly every time.
  const load = useCallback(async () => {
    setLoadError(false);
    const [identity, merchant] = await Promise.all([
      getIdentityCheckState(),
      getMerchantState(),
    ]);

    if (!identity.ok && !merchant.ok) {
      if (!seeded.current) setLoadError(true);
      setLoaded(true);
      return null;
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

    return { identityOk, payoutOk, merchantRef: merchant.ok ? merchant.data.merchantRef : null };
  }, []);

  /**
   * Ask the PROVIDER, not our database, and keep asking while it is still deciding
   * (Req 13.3).
   *
   * This is the reliable path the spec has always called for, and the surface has to
   * own it. Mounting `IdentityReturnRefresh` here instead is not an option: it strips
   * `?identity=complete` from the URL, and that marker is what `app/onboarding/page.tsx`
   * reads to open the wizard on this step — removing it would bounce a returning member
   * back to the welcome screen.
   */
  const reconcile = useCallback(async (run: number) => {
    const current = () => runId.current === run;

    const snapshot = await load();
    if (!snapshot || !current()) return;

    if (!snapshot.identityOk) {
      let verdictReached = false;

      for (let attempt = 0; attempt <= REVIEW_POLL_DELAYS_MS.length; attempt += 1) {
        const read = await refreshIdentityCheck();
        if (!current()) return;

        if (!read.ok) {
          // NO_CHECK means nothing was ever started, so no verdict is coming and the
          // step is simply waiting on the member. Any other failure is a transport
          // problem, and a stale spine beats inventing a refusal.
          verdictReached = true;
          break;
        }

        if (read.data.status === 'VERIFIED') {
          setIdentityDone(true);
          setVerifiedName(read.data.verifiedName);
          setIdentityProblem(null);
          settledChange.current?.(snapshot.payoutOk);
          verdictReached = true;
          break;
        }

        if (read.data.status === 'FAILED') {
          // Stripe's own sentence when it gave one ("The document is invalid."), because
          // it tells the member what to change. Ours only when it did not.
          setIdentityProblem(read.data.failureReason ?? DECLINED_WITHOUT_REASON);
          verdictReached = true;
          break;
        }

        const delay = REVIEW_POLL_DELAYS_MS[attempt];
        if (delay === undefined) break;

        // Only now is it true that a real session is mid-review. Setting this before
        // the first read would flash "Checking" at members who never started one.
        setIdentityChecking(true);
        await sleep(delay);
        if (!current()) return;
      }

      if (!current()) return;
      setIdentityChecking(false);
      if (!verdictReached) setIdentityProblem(STILL_UNDER_REVIEW);
    }

    // Payouts get the same read-back but no poll. Connect reports `payouts_enabled` on
    // the return itself, and where it does not the wait is a genuine multi-minute
    // review that a forty-second spinner would misrepresent as nearly done.
    if (!snapshot.payoutOk && snapshot.merchantRef) {
      const read = await refreshPayoutStatus();
      if (!current()) return;
      if (read.ok && read.data.settlementsEnabled) {
        setPayoutDone(true);
        settledChange.current?.(true);
      }
    }
  }, [load]);

  useEffect(() => {
    const run = runId.current + 1;
    runId.current = run;
    void reconcile(run);
    return () => {
      runId.current += 1;
    };
  }, [reconcile]);

  function finishIdentity() {
    setIdentityDone(true);
    setIdentityProblem(null);
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
          problem={identityProblem}
          hasNext
        >
          {identityChecking ? (
            <p
              role="status"
              className="flex items-center gap-snug text-body leading-relaxed text-muted-foreground"
            >
              <HugeiconsIcon
                icon={LoaderCircleIcon}
                className="size-4 shrink-0 animate-spin"
                aria-hidden
              />
              Checking with Stripe…
            </p>
          ) : (
            <HostedProviderStep
              step="identity"
              returnPath={returnPath}
              onComplete={finishIdentity}
              retry={identityProblem !== null}
            />
          )}
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
