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
import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
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

/**
 * Shown when the poll budget runs out with the session still under review.
 *
 * PHRASED AS A WAIT, NOT A PROBLEM, and rendered in the waiting slot rather than the
 * `problem` one. It used to go into `problem`, which also flipped the button to "Try
 * again" — so a member whose document was being reviewed perfectly normally was told,
 * in effect, that their attempt had failed and they should start over. The two states
 * now render differently because they ARE different: one is waiting on Stripe, the
 * other is waiting on the member.
 */
const STILL_UNDER_REVIEW =
  'Stripe is still reviewing your document. Checks usually finish in a few minutes, but a manual review can take longer. You can safely leave this page — we will update it when the result arrives.';

/** Shown while a submitted document is known to be with the provider. */
const UNDER_REVIEW_NOW =
  'Your document is with Stripe. This usually takes a minute or two, and there is nothing for you to do.';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Both gates as a caller already knows them, for {@link UnifiedOnboardingSurfaceProps.initialStatus}. */
export interface OnboardingStatusSnapshot {
  identityDone: boolean;
  payoutDone: boolean;
  verifiedName: string | null;
  /**
   * Whether the member's last identity attempt was DECLINED, when the caller knows.
   *
   * Carried separately from `identityDone` because "not verified" is three different
   * screens — never started, under review, declined — and a boolean can only say which
   * one by accident. Optional: a caller that does not know omits it and the mount
   * read-back settles it a moment later.
   */
  identityFailed?: boolean;
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
  /**
   * The provider's DECLINE, and nothing else.
   *
   * It used to double as "no verdict yet", which is what put review copy next to a
   * "Try again" button. A wait is now {@link identityWaiting} instead.
   */
  const [identityProblem, setIdentityProblem] = useState<string | null>(
    // A server render that already knows the last attempt was declined says so on the
    // first paint, rather than offering "Continue with Stripe" and correcting itself.
    initialStatus?.identityFailed ? DECLINED_WITHOUT_REASON : null,
  );
  /**
   * Why the member is waiting rather than acting, when they are.
   *
   * PERSISTENT, UNLIKE {@link identityChecking}, which lives only for the duration of
   * the poll loop and is reset once per component instance. A submitted document under
   * review has to keep reading as one across re-mounts and tab switches — the previous
   * behaviour showed the spinner for forty seconds and then reverted to a screen
   * indistinguishable from never having started.
   */
  const [identityWaiting, setIdentityWaiting] = useState<string | null>(null);
  /** True while an on-demand "Check again" is in flight. */
  const [identityRechecking, setIdentityRechecking] = useState(false);

  const settledChange = useRef(onSettledChange);
  settledChange.current = onSettledChange;

  // Read through a ref for the same reason as `settledChange`: `reconcile` is a
  // `useCallback` the mount effect depends on, so anything captured directly would have
  // to join its dependency list, and a dependency that changes identity per render
  // re-fires the effect and re-runs the whole reconciliation.
  const routerRef = useRef(router);
  routerRef.current = router;

  /**
   * Whether each step has EVER been observed complete during this visit.
   *
   * COMPLETION IS MONOTONIC WITHIN A MOUNT, and this is what makes it so. `load` reads
   * our own columns, which a webhook writes, and it says so itself: fast enough to
   * paint against, not authoritative. Feeding that read straight into the state meant a
   * weaker source could RETRACT a fact a stronger one had already established — so a
   * step that had just ticked flipped back to "Continue with Stripe" the next time the
   * columns were read, then forward again when the provider was asked. That is the
   * flicker; the ticks were not disagreeing about the truth, they were disagreeing
   * about which read won.
   *
   * Refs rather than reading the state, because `load` sets both and then reports the
   * pair to `onSettledChange` in the same pass — state updates are not visible until
   * the next render, so the report would lag one read behind and drive the same flicker
   * in the wizard's footer controls.
   *
   * A GENUINE downgrade (Stripe later restricts an account) still shows, because it
   * arrives as a fresh server render and therefore a fresh `initialStatus`. What is
   * suppressed is only a retraction mid-visit, and no in-session path produces one
   * deliberately: every provider read-back below sets done and never clears it.
   */
  const everIdentityDone = useRef(initialStatus?.identityDone ?? false);
  const everPayoutDone = useRef(initialStatus?.payoutDone ?? false);

  /** Latch identity complete. Always use these rather than `setXDone(true)` directly. */
  const markIdentityDone = useCallback(() => {
    everIdentityDone.current = true;
    setIdentityDone(true);
  }, []);

  /** Latch payouts complete. */
  const markPayoutDone = useCallback(() => {
    everPayoutDone.current = true;
    setPayoutDone(true);
  }, []);

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

  // Whether the identity poll has already run to a conclusion for this component.
  //
  // `<Activity>` tears down a hidden tab's effects and rebuilds them when it is shown,
  // so on the Account hub the mount effect below fires every time Verification is
  // opened — and each firing replayed the whole forty-second poll from the first read
  // to the last. The cheap column read still runs on every mount, because that is what
  // lets a member back from Stripe see the truth before the webhook lands; only the
  // poll is held to once.
  //
  // A run superseded mid-flight never sets this, so an interrupted poll is still
  // retried on the next open and `identityChecking` cannot stick on. That is also what
  // keeps StrictMode's mount/unmount/mount honest: the first run is superseded before
  // it can conclude, so the second still polls.
  //
  // The ref survives the hide/show cycle because Activity preserves state and tears
  // down effects alone.
  const identityPolled = useRef(false);

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

    // Latched, not assigned. See `everIdentityDone` for why a column read must not be
    // allowed to un-tick a step the provider already confirmed.
    if (identity.ok && identity.data.status === 'VERIFIED') everIdentityDone.current = true;
    if (merchant.ok && merchant.data.settlementsEnabled) everPayoutDone.current = true;
    const identityOk = everIdentityDone.current;
    const payoutOk = everPayoutDone.current;

    setIdentityDone(identityOk);
    // Only overwrite a name with one that exists: the same absent→present rule the
    // provider-reported name follows server-side. A column read that raced the webhook
    // would otherwise blank the receipt under an already-ticked step.
    setVerifiedName((current) => (identity.ok ? (identity.data.verifiedName ?? current) : current));

    // Our columns DO know the difference between declined and not-yet-started, and
    // throwing that away is what made a refusal render as a fresh start. They cannot
    // see a review in progress — there is no column for it — so that stays with the
    // read-back below.
    if (identity.ok && identity.data.status === 'FAILED') {
      setIdentityProblem((current) => current ?? DECLINED_WITHOUT_REASON);
    }
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
      // Whether the LAST read actually found the provider mid-review. The lapsed-budget
      // copy below is only honest if it did — a member who started a session and
      // abandoned it is waiting on themselves, and telling them Stripe is still
      // reviewing would be a spinner that nothing can ever clear.
      let sawProcessing = false;

      // ONE READ ALWAYS, THE LOOP AT MOST ONCE. The distinction matters because the
      // loop is held to a single run per component instance, and `<Activity>` re-mounts
      // this surface every time the Verification tab is opened. Gating the whole block
      // on that ref meant a member returning to a document still under review got the
      // untouched-step screen, since our own columns cannot see a review in progress.
      // One provider read is what recovers it; the repeated polling is the expensive
      // part and stays capped.
      const mayPoll = !identityPolled.current;

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
          markIdentityDone();
          setVerifiedName(read.data.verifiedName);
          setIdentityProblem(null);
          setIdentityWaiting(null);
          settledChange.current?.(snapshot.payoutOk);
          // THE READ-BACK FOUND IT, SO THE SERVER DOES NOT KNOW YET. Anything on the
          // page rendered from these columns on the server — the account header's
          // verification line, for one — is still showing the pre-check answer and
          // cannot follow client state. Refreshing is what stops the header
          // contradicting the tick beside it. Self-terminating: the next server render
          // reports done, so `snapshot.identityOk` is true and this branch is not
          // reached again.
          routerRef.current.refresh();
          verdictReached = true;
          break;
        }

        if (read.data.status === 'FAILED') {
          // Stripe's own sentence when it gave one ("The document is invalid."), because
          // it tells the member what to change. Ours only when it did not.
          setIdentityProblem(read.data.failureReason ?? DECLINED_WITHOUT_REASON);
          setIdentityWaiting(null);
          verdictReached = true;
          break;
        }

        // THE PROVIDER HAS THE DOCUMENT. Say so from the first read, and keep saying
        // it: this is the state that previously rendered as though nothing had
        // happened. Distinguishing it is the whole reason `progress` exists — a PENDING
        // status alone cannot tell "submitted, under review" from "never started".
        if (read.data.progress === 'PROCESSING') {
          sawProcessing = true;
          setIdentityWaiting(UNDER_REVIEW_NOW);
          setIdentityProblem(null);
        } else {
          // AN UNFINISHED SESSION, AND NO VERDICT IS COMING — the member started and
          // walked away without submitting, so polling would ask the same question
          // forty times and get the same answer. Stop, and leave the step offering its
          // button rather than a spinner that stands in front of the only useful
          // control on the page.
          sawProcessing = false;
          setIdentityWaiting(null);
          break;
        }

        // A re-mount gets its single read above and stops here, leaving the waiting
        // copy standing rather than replacing it with a spinner that cannot resolve.
        if (!mayPoll) break;

        const delay = REVIEW_POLL_DELAYS_MS[attempt];
        if (delay === undefined) break;

        // Only now is it true that a real session is mid-review. Setting this before
        // the first read would flash "Checking" at members who never started one.
        setIdentityChecking(true);
        await sleep(delay);
        if (!current()) return;
      }

      if (!current()) return;
      // Only a run that was ALLOWED to poll consumes the budget. A read-only pass on a
      // re-mount must not, or the first real visit could be denied its poll.
      if (mayPoll) identityPolled.current = true;
      setIdentityChecking(false);
      // A budget that ran out on a review still running leaves the member WAITING, not
      // failed. This used to write into `identityProblem`, which put review copy in the
      // problem box and relabelled the button "Try again" — telling someone whose check
      // was progressing normally to start over.
      if (!verdictReached && sawProcessing && mayPoll) setIdentityWaiting(STILL_UNDER_REVIEW);
    }

    // Payouts get the same read-back but no poll. Connect reports `payouts_enabled` on
    // the return itself, and where it does not the wait is a genuine multi-minute
    // review that a forty-second spinner would misrepresent as nearly done.
    if (!snapshot.payoutOk && snapshot.merchantRef) {
      const read = await refreshPayoutStatus();
      if (!current()) return;
      if (read.ok && read.data.settlementsEnabled) {
        markPayoutDone();
        settledChange.current?.(true);
        // Same reasoning as the identity read-back above. This is the case that shipped
        // visibly: the spine read "Payouts active" while the header two rows higher
        // still read "Payouts not set up", because that line is a server-rendered prop
        // and only this read knew any better.
        routerRef.current.refresh();
      }
    }
  }, [load, markIdentityDone, markPayoutDone]);

  useEffect(() => {
    const run = runId.current + 1;
    runId.current = run;
    void reconcile(run);
    return () => {
      runId.current += 1;
    };
  }, [reconcile]);

  function finishIdentity() {
    markIdentityDone();
    setIdentityProblem(null);
    setIdentityWaiting(null);
    void load();
  }

  /**
   * Starting the check revealed the provider is already reviewing a submission.
   *
   * Reached when there was no link to send the member to — which is a confirmation
   * rather than a fault, and used to surface as "could not open Stripe".
   */
  function identityUnderReview() {
    setIdentityProblem(null);
    setIdentityWaiting(UNDER_REVIEW_NOW);
  }

  /**
   * Ask the provider once more, on demand.
   *
   * THE ONE THING A WAITING MEMBER CAN ACTUALLY DO, and the previous copy's advice was
   * to reload the page — which re-ran the whole surface to answer a question a single
   * request answers. It also gives the review state an honest control, so the step is
   * not a spinner with no affordance at all.
   */
  function recheckIdentity() {
    setIdentityRechecking(true);
    void (async () => {
      const read = await refreshIdentityCheck();
      setIdentityRechecking(false);
      if (!read.ok) return;

      if (read.data.status === 'VERIFIED') {
        markIdentityDone();
        setVerifiedName(read.data.verifiedName);
        setIdentityProblem(null);
        setIdentityWaiting(null);
        settledChange.current?.(payoutDone);
        routerRef.current.refresh();
        return;
      }
      if (read.data.status === 'FAILED') {
        setIdentityProblem(read.data.failureReason ?? DECLINED_WITHOUT_REASON);
        setIdentityWaiting(null);
        return;
      }
      // Still nothing decided. Leave the waiting copy in place rather than clearing it
      // and offering a button the member has no use for.
      setIdentityWaiting(read.data.progress === 'PROCESSING' ? UNDER_REVIEW_NOW : null);
    })();
  }

  function finishPayout() {
    markPayoutDone();
    if (onComplete) onComplete();
    else router.push('/');
  }

  if (!loaded) {
    // SHAPED LIKE THE SPINE IT REPLACES: two marker-plus-text rows at the same widths
    // and heights. The previous skeleton was three unrelated bars roughly a third of
    // the loaded height, so resolving it resized the dialog and the whole panel moved.
    //
    // Three things it still got wrong, all fixed here. The action was drawn on the
    // SECOND step, but `OnboardingStep` renders its children only while `active`, and
    // step two stays `upcoming` until identity passes — so the button appeared under
    // the wrong step, vanished, and reappeared ~130px higher. It was also `h-10 w-44`
    // against a real `h-9 w-full sm:w-auto`, and its `mt-group` never applied because
    // the parent's `space-y-tight` outranks a margin utility. And the 3px rail that
    // runs the height of both steps had no placeholder at all, so it materialised out
    // of nothing; the gap between steps is `pb-section` INSIDE the content column, not
    // a hard break across both, which is what keeps that rail continuous.
    return (
      <div className="grid gap-0" role="status" aria-label="Loading your setup">
        {[0, 1].map((row) => (
          <div key={row} className="grid grid-cols-[auto_1fr] gap-x-group">
            <div className="flex flex-col items-center">
              <span aria-hidden className="w-[3px] flex-1 rounded-full bg-transparent" />
              <Skeleton className="my-tight size-7 shrink-0 rounded-full" />
              <span
                aria-hidden
                className={cn(
                  'w-[3px] flex-1 rounded-full',
                  row === 0 ? 'bg-border' : 'bg-transparent',
                )}
              />
            </div>
            <div className="min-w-0 py-tight">
              <div className="flex flex-col gap-cozy sm:flex-row sm:items-start sm:justify-between sm:gap-group">
                <div className="min-w-0 flex-1">
                  <TextLines className="text-lead" widths={['w-40']} />
                  {/* Both step descriptions run past 75 characters, so they wrap
                      in the dialog's content column. */}
                  <TextLines
                    className="mt-tight text-body"
                    widths={['w-full', 'w-2/3']}
                  />
                </div>
                {/* Step one is the active step on a fresh mount, so it is the one
                    that carries a control. */}
                {row === 0 ? (
                  <Skeleton className="h-9 w-full shrink-0 rounded-md sm:w-44" />
                ) : null}
              </div>
            </div>
            <div className="flex justify-center">
              <span
                aria-hidden
                className={cn(
                  'w-[3px] rounded-full',
                  row === 0 ? 'bg-border' : 'bg-transparent',
                )}
              />
            </div>
            <div className={cn('min-w-0', row === 0 ? 'pb-section' : 'pb-0')} />
          </div>
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-cozy">
        <p role="alert" className="text-body text-destructive">
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
        <HugeiconsIcon icon={ArrowRight01Icon} className="ml-snug size-4" aria-hidden />
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
          // THE DECLINE ONLY. A wait is rendered as one below, because routing it here
          // also relabelled the button "Try again".
          problem={identityProblem}
          hasNext
        >
          {identityWaiting || identityChecking ? (
            // WAITING ON THE PROVIDER, so there is deliberately no "Continue with
            // Stripe" here: the member has already done their part and a button that
            // restarts the check is the wrong thing to put in front of them. This state
            // replaces the one where a submitted document rendered exactly like an
            // untouched step.
            <div className="flex min-w-0 flex-col items-stretch gap-snug sm:max-w-xs sm:items-end">
              <p
                role="status"
                className="flex min-w-0 items-start gap-snug text-pretty text-body text-muted-foreground sm:text-right"
              >
                <HugeiconsIcon
                  icon={LoaderCircleIcon}
                  className="mt-0.5 size-4 shrink-0 animate-spin"
                  aria-hidden
                />
                <span>{identityWaiting ?? 'Checking with Stripe…'}</span>
              </p>

              {/* Only once the automatic polling has given up. While it is still running
                  this would race it and ask the member to do what the page is already
                  doing. */}
              {identityWaiting && !identityChecking ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={recheckIdentity}
                  disabled={identityRechecking}
                  aria-busy={identityRechecking}
                  className="w-full sm:w-auto"
                >
                  {identityRechecking ? 'Checking…' : 'Check again'}
                </Button>
              ) : null}
            </div>
          ) : (
            <HostedProviderStep
              step="identity"
              returnPath={returnPath}
              onComplete={finishIdentity}
              onProcessing={identityUnderReview}
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

          Which is why it is overridable rather than fixed. The default calls
          `finishPayout`, which is a wizard exit — correct for a flow the member is
          trying to leave, wrong on a settings tab they can simply stay on. That caller
          passes a plain link instead; see `VerificationSequence`. */}
      {bothDone ? exit : null}
    </div>
  );
}
