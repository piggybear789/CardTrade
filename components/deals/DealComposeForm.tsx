'use client';

// components/deals/DealComposeForm.tsx
//
// Start a private deal: sell a card, or trade cards. Anyone can write one. The
// account is asked for at Get link, after the work is done, and the draft — photos
// included — survives that sign-in in IndexedDB (`dealDraftStore`).
//
//   Deal type    sell or trade
//   Your card    photos first, then what it is, category and condition
//   Price        what they pay, the fee, what you receive              (sell)
//   Trade terms  what you want, what yours is worth, the hold and fee  (trade)
//   Review      the invite as they will see it, and what happens next
//   then, only when needed:
//   Save your deal  sign in (a signed-out visitor)
//   Almost done     the name others see, and where they trade (a new account)
//
// STRIPE IDENTITY IS NOT ASKED FOR HERE, AND THE COPY SAYS EXACTLY WHERE IT IS: a
// seller verifies (and finishes payout setup) before the buyer can pay, and BOTH
// traders verify before a swap can start. Those are the checks `acceptCashSaleTerms`
// and `acceptTradeTerms` enforce; nothing on these screens may read as optional
// about them.
//
// KEPT from the previous composer: the line above the action names the next thing
// to do while the button is disabled.

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { BanknoteIcon, LoaderCircleIcon, RepeatIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { FieldError } from '@/components/motion/FieldError';
import { Button } from '@/components/ui/button';
import { PendingLabel } from '@/components/ui/pending-label';
import { ChoiceTile } from '@/components/ui/choice-tile';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  EMPTY_UNLISTED_DRAFT,
  type UnlistedItemDraft,
} from '@/components/trade/UnlistedItemFields';
import {
  clearDealDraft,
  loadDealDraft,
  saveDealDraft,
  type DraftKind,
} from '@/components/deals/dealDraftStore';
import {
  DEAL_STEP_PROGRESS,
  DealCardStep,
  DealReviewStep,
  DealTermsStep,
  StepHeader,
  dealStepGap,
} from '@/components/deals/DealSteps';
import { DEAL_INVITE_ERROR_COPY } from '@/components/deals/inviteErrors';
import { QuickProfileFields } from '@/components/deals/QuickProfileFields';
import { pathsFromUnlistedDraft } from '@/components/deals/uploadDealItem';
import { cashPriceProblem, dollarsToCents } from '@/domain/deals/dealInvite';
import { createDealInvite } from '@/lib/actions/dealInvites';
import { completeQuickOnboarding } from '@/lib/actions/quickOnboarding';
import type { SelectableRegion } from '@/lib/actions/regionOptions';
import { DEAL_RESUME_PATH } from '@/lib/deals/paths';
import { navigateWithType } from '@/lib/motion/navigate';

type Step = 'kind' | 'card' | 'terms' | 'review' | 'account' | 'profile';

/** Where each step's back arrow goes. `kind` has none. */
const BACK: Record<Exclude<Step, 'kind'>, Step> = {
  card: 'kind',
  terms: 'card',
  review: 'terms',
  account: 'review',
  profile: 'review',
};

/** The three steps the progress bar counts. The chooser and the account steps sit outside it. */
const PROGRESS: Partial<Record<Step, number>> = DEAL_STEP_PROGRESS;

export interface DealComposerViewer {
  signedIn: boolean;
  /** A new account that has not yet given a display name and trading region. */
  needsOnboarding: boolean;
  displayName: string | null;
}

export interface DealComposeFormProps {
  viewer: DealComposerViewer;
  /** Regions a new account may choose, for the two-question step. */
  regions: SelectableRegion[];
  /** Where that picker starts: the member's region, else the one they browse. */
  suggestedRegion: string | null;
  /** The currency the price is quoted in, from the same region. */
  quoteCurrency: string;
  /** Returning from sign-in: pick the stored draft back up. */
  resume: boolean;
  onSuccess?: () => void;
}

export function DealComposeForm({
  viewer,
  regions,
  suggestedRegion,
  quoteCurrency,
  resume,
  onSuccess,
}: DealComposeFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<DraftKind | null>(null);
  const [step, setStep] = useState<Step>('kind');
  const [card, setCard] = useState<UnlistedItemDraft>(EMPTY_UNLISTED_DRAFT);
  const [priceDollars, setPriceDollars] = useState('');
  const [valueDollars, setValueDollars] = useState('');
  const [wanted, setWanted] = useState('');
  const [displayName, setDisplayName] = useState(viewer.displayName ?? '');
  const [regionCode, setRegionCode] = useState(suggestedRegion ?? regions[0]?.code ?? '');
  const [restoring, setRestoring] = useState(resume);

  // Back from sign-in: restore the draft and carry on from where Get link was pressed.
  useEffect(() => {
    if (!resume) return;
    let cancelled = false;
    void loadDealDraft().then((stored) => {
      if (cancelled) return;
      setRestoring(false);
      if (!stored) return;
      setKind(stored.kind);
      setCard(stored.card);
      setPriceDollars(stored.priceDollars);
      setValueDollars(stored.valueDollars);
      setWanted(stored.wanted);
      setStep(viewer.signedIn && viewer.needsOnboarding ? 'profile' : 'review');
    });
    return () => {
      cancelled = true;
    };
  }, [resume, viewer.signedIn, viewer.needsOnboarding]);

  const selling = kind === 'CASH_SALE';
  const priceCents = dollarsToCents(priceDollars);
  const valueCents = dollarsToCents(valueDollars);

  /**
   * What the current step still needs, or `null` when it is complete. Drives the
   * line beside the action AND the button's disabled state, so the two cannot
   * disagree. Presence only — range rules come back as messages on Next. The card
   * and terms rules are shared with the editor (`dealStepGap`).
   */
  function gap(): string | null {
    if (step === 'card' || step === 'terms') {
      return dealStepGap(step, { card, selling, priceCents, wanted, valueCents });
    }
    if (step === 'profile') {
      if (displayName.trim() === '') return 'Add the name other members see.';
      if (!regionCode) return 'Choose where you trade.';
    }
    return null;
  }
  const missing = gap();

  function go(next: Step) {
    setError(null);
    setStep(next);
  }

  function chooseKind(next: DraftKind) {
    setKind(next);
    go('card');
  }

  function leaveTerms() {
    if (selling) {
      const problem = cashPriceProblem(priceCents);
      if (problem) {
        setError(problem);
        return;
      }
    }
    go('review');
  }

  function getLink() {
    setError(null);
    if (!kind) return;
    if (!viewer.signedIn) {
      // THE ONE WRITE. The draft is only ever restored on the way back from sign-in,
      // so it is saved here, as the visitor heads there, rather than on every edit
      // (which would rewrite every photo on each pause in typing). Pressing Get link
      // again after going back to edit saves the edited draft. Awaited, so the
      // sign-in buttons only appear once the write is done.
      const draftKind = kind;
      startTransition(async () => {
        await saveDealDraft({ kind: draftKind, card, priceDollars, valueDollars, wanted });
        go('account');
      });
      return;
    }
    if (viewer.needsOnboarding) {
      go('profile');
      return;
    }
    startTransition(async () => {
      await createLink();
    });
  }

  function finishProfile() {
    setError(null);
    startTransition(async () => {
      const done = await completeQuickOnboarding({ displayName: displayName.trim(), regionCode });
      if (!done.ok) {
        setError(done.message);
        return;
      }
      await createLink();
    });
  }

  async function createLink() {
    if (!kind) return;
    const fmvCents = selling ? priceCents : valueCents;
    if (fmvCents == null || fmvCents < 1) {
      setError(selling ? 'Enter a price.' : 'Say what your card is worth.');
      return;
    }
    const uploaded = await pathsFromUnlistedDraft(card, fmvCents);
    if (!uploaded.ok) {
      setError(uploaded.message);
      return;
    }
    const result = selling
      ? await createDealInvite({
          kind: 'CASH_SALE',
          hostRole: 'SELLER',
          item: uploaded.item,
          priceCents: fmvCents,
        })
      : // An even swap. Cash to even, if any, is agreed in the room.
        await createDealInvite({
          kind: 'TRADE',
          item: uploaded.item,
          wantedDescription: wanted,
          cashAmountCents: 0,
          cashDirection: 'PROPOSER_PAYS',
          declaredValueCents: fmvCents,
        });
    if (!result.ok) {
      const message = result.message || DEAL_INVITE_ERROR_COPY[result.error];
      setError(message);
      toast.error(message);
      return;
    }
    await clearDealDraft();
    onSuccess?.();
    navigateWithType(router, result.data.path, 'nav-forward');
  }

  if (restoring) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Picking up your deal</DialogTitle>
          <DialogDescription>Restoring your card and photos.</DialogDescription>
        </DialogHeader>
        <div role="status" className="flex justify-center py-section text-muted-foreground">
          <HugeiconsIcon icon={LoaderCircleIcon} className="size-5 animate-spin" aria-hidden />
          <span className="sr-only">Loading</span>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------- deal type ----
  if (step === 'kind' || !kind) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Start a deal</DialogTitle>
          <DialogDescription>Send someone a link and agree the details together.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-snug">
          <ChoiceTile
            id="deal-kind-cash"
            name="deal-kind"
            type="radio"
            checked={false}
            onChange={() => chooseKind('CASH_SALE')}
            icon={BanknoteIcon}
            label="Sell a card"
            hint="Set a price, send a link"
            align="center"
            layout="stacked"
          />
          <ChoiceTile
            id="deal-kind-trade"
            name="deal-kind"
            type="radio"
            checked={false}
            onChange={() => chooseKind('TRADE')}
            icon={RepeatIcon}
            label="Trade cards"
            hint="Swap, with cash if needed"
            align="center"
            layout="stacked"
          />
        </div>
        {/* NO CANCEL. The dialog's own close button already dismisses it, and a
            second exit beside two equal paths was a third choice to read. */}
      </>
    );
  }

  const title =
    step === 'review'
      ? 'Review your deal'
      : step === 'account'
        ? 'Save your deal'
        : step === 'profile'
          ? 'Almost done'
          : selling
            ? 'Sell a card'
            : 'Trade cards';

  return (
    <>
      <StepHeader
        title={title}
        progress={PROGRESS[step]}
        onBack={() => go(BACK[step])}
        backDisabled={isPending}
        description={
          step === 'account' ? 'Sign in to get the link. Your draft is kept.' : undefined
        }
      />

      <div className="space-y-group">
        {step === 'card' ? (
          <DealCardStep card={card} onCard={setCard} selling={selling} idPrefix="deal-card" />
        ) : null}

        {step === 'terms' ? (
          <DealTermsStep
            selling={selling}
            idPrefix="deal"
            currency={quoteCurrency}
            priceDollars={priceDollars}
            onPriceDollars={setPriceDollars}
            wanted={wanted}
            onWanted={setWanted}
            valueDollars={valueDollars}
            onValueDollars={setValueDollars}
          />
        ) : null}

        {step === 'review' ? (
          <DealReviewStep
            card={card}
            selling={selling}
            priceCents={priceCents}
            wanted={wanted}
            currency={quoteCurrency}
          />
        ) : null}

        {step === 'account' ? (
          <div className="grid gap-snug">
            <GoogleSignInButton mode="sign-up" redirectTo={DEAL_RESUME_PATH}>
              Continue with Google
            </GoogleSignInButton>
            <Button asChild variant="outline" className="min-h-11 w-full">
              <Link href={`/sign-up?redirectTo=${encodeURIComponent(DEAL_RESUME_PATH)}`}>
                Continue with email
              </Link>
            </Button>
            <p className="text-meta text-muted-foreground">
              Already have an account?{' '}
              <Link
                href={`/sign-in?redirectTo=${encodeURIComponent(DEAL_RESUME_PATH)}`}
                className="font-medium text-foreground underline underline-offset-4"
              >
                Sign in
              </Link>
            </p>
          </div>
        ) : null}

        {step === 'profile' ? (
          <QuickProfileFields
            idPrefix="deal"
            displayName={displayName}
            onDisplayName={setDisplayName}
            regionCode={regionCode}
            onRegion={setRegionCode}
            regions={regions}
            quoteCurrency={quoteCurrency}
          />
        ) : null}

        <FieldError message={error ?? undefined} />
      </div>

      {step === 'account' ? null : (
        <>
          <p className="text-meta text-muted-foreground" id="deal-step-blocker">
            {missing && !isPending
              ? missing
              : step === 'review' && !viewer.signedIn
                ? "You'll sign in next."
                : null}
          </p>
          <DialogFooter>
            <Button
              type="button"
              onClick={
                step === 'card'
                  ? () => go('terms')
                  : step === 'terms'
                    ? leaveTerms
                    : step === 'profile'
                      ? finishProfile
                      : getLink
              }
              disabled={isPending || missing != null}
              aria-busy={isPending}
              aria-describedby="deal-step-blocker"
            >
              {/* Width-stable: the pending text and spinner share the resting label's
                  grid cell, so the footer does not slide while the link is made. */}
              <PendingLabel
                pending={isPending}
                pendingLabel={viewer.signedIn ? 'Creating link…' : 'Saving…'}
              >
                {step === 'card' || step === 'terms' ? 'Next' : 'Get link'}
              </PendingLabel>
            </Button>
          </DialogFooter>
        </>
      )}
    </>
  );
}
