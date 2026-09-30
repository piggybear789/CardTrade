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
import {
  ArrowLeft01Icon,
  BanknoteIcon,
  LoaderCircleIcon,
  RepeatIcon,
} from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { FieldError } from '@/components/motion/FieldError';
import { Button } from '@/components/ui/button';
import { ChoiceTile } from '@/components/ui/choice-tile';
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Textarea } from '@/components/ui/textarea';
import {
  EMPTY_UNLISTED_DRAFT,
  UnlistedCategoryConditionFields,
  UnlistedDescriptionField,
  UnlistedPhotoField,
  UnlistedTitleField,
  unlistedDraftGap,
  type UnlistedItemDraft,
} from '@/components/trade/UnlistedItemFields';
import {
  clearDealDraft,
  loadDealDraft,
  saveDealDraft,
  type DraftKind,
} from '@/components/deals/dealDraftStore';
import { SaleTermsBreakdown, TradeTermsBreakdown } from '@/components/deals/DealTermsBreakdown';
import { DEAL_INVITE_ERROR_COPY } from '@/components/deals/inviteErrors';
import { QuickProfileFields } from '@/components/deals/QuickProfileFields';
import { pathsFromUnlistedDraft } from '@/components/deals/uploadDealItem';
import { cashPriceProblem, dollarsToCents } from '@/domain/deals/dealInvite';
import { platformFeeCentsFor } from '@/domain/orchestrator/cashSaleOrchestrator';
import { deriveItemTitle } from '@/domain/validation';
import { createDealInvite } from '@/lib/actions/dealInvites';
import { completeQuickOnboarding } from '@/lib/actions/quickOnboarding';
import type { SelectableRegion } from '@/lib/actions/regionOptions';
import { DEAL_RESUME_PATH } from '@/lib/deals/paths';
import { formatMoney } from '@/lib/format';
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
const PROGRESS: Partial<Record<Step, number>> = { card: 1, terms: 2, review: 3 };

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
  const money = (cents: number) => formatMoney(cents, quoteCurrency);

  /**
   * What the current step still needs, or `null` when it is complete. Drives the
   * line beside the action AND the button's disabled state, so the two cannot
   * disagree. Presence only — range rules come back as messages on Next.
   */
  function gap(): string | null {
    if (step === 'card') return unlistedDraftGap(card);
    if (step === 'terms') {
      if (selling) return priceCents == null ? 'Enter a price.' : null;
      if (wanted.trim() === '') return 'Say what you want for it.';
      if (valueCents == null || valueCents < 1) return 'Say what your card is worth.';
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
            align="center"
            size="lg"
          />
          <ChoiceTile
            id="deal-kind-trade"
            name="deal-kind"
            type="radio"
            checked={false}
            onChange={() => chooseKind('TRADE')}
            icon={RepeatIcon}
            label="Trade cards"
            align="center"
            size="lg"
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
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
          <>
            <UnlistedPhotoField draft={card} onChange={setCard} idPrefix="deal-card" />
            <UnlistedTitleField draft={card} onChange={setCard} idPrefix="deal-card" />
            <UnlistedDescriptionField
              draft={card}
              onChange={setCard}
              idPrefix="deal-card"
              label={selling ? 'What are you selling?' : 'What are you swapping?'}
              placeholder="Condition details, grade, anything they should know."
            />
            <UnlistedCategoryConditionFields draft={card} onChange={setCard} idPrefix="deal-card" />
          </>
        ) : null}

        {step === 'terms' && selling ? (
          <>
            <div className="space-y-snug">
              <Label htmlFor="deal-price">Price</Label>
              <MoneyInput
                id="deal-price"
                size="lg"
                min="0.01"
                value={priceDollars}
                onChange={(event) => setPriceDollars(event.target.value)}
              />
            </div>
            <SaleTermsBreakdown priceCents={priceCents} currency={quoteCurrency} />
            <p className="text-meta text-muted-foreground">
              Postage or a meetup is agreed in the deal room.
            </p>
          </>
        ) : null}

        {step === 'terms' && !selling ? (
          <>
            <div className="space-y-snug">
              <Label htmlFor="deal-wanted">What do you want for it?</Label>
              <Textarea
                id="deal-wanted"
                value={wanted}
                onChange={(event) => setWanted(event.target.value)}
                maxLength={1000}
                rows={2}
                placeholder="The card, set or grade they should put up."
                className="resize-none"
              />
            </div>
            <div className="space-y-snug">
              <Label htmlFor="deal-value">What is your card worth?</Label>
              <MoneyInput
                id="deal-value"
                size="lg"
                min="0.01"
                value={valueDollars}
                onChange={(event) => setValueDollars(event.target.value)}
              />
            </div>
            <TradeTermsBreakdown valueCents={valueCents} currency={quoteCurrency} />
          </>
        ) : null}

        {step === 'review' ? (
          <>
            <div className="space-y-snug">
              <p className="text-meta text-muted-foreground">What they will see</p>
              <DraftPreview
                card={card}
                line={
                  selling
                    ? priceCents
                      ? `They pay ${money(priceCents + platformFeeCentsFor(priceCents, quoteCurrency))}`
                      : null
                    : `Wants: ${wanted.trim()}`
                }
              />
            </div>
            <div className="space-y-snug">
              <p className="text-meta text-muted-foreground">What happens next</p>
              <NextSteps
                items={
                  selling
                    ? [
                        'They join. Nothing is charged.',
                        'You agree the handover in the deal room.',
                        'You verify with Stripe Identity and set up payouts, then they pay.',
                      ]
                    : [
                        'They join with the card they are offering.',
                        'You agree the trade in the deal room.',
                        'You both verify with Stripe Identity, then a hold goes on each card.',
                      ]
                }
              />
            </div>
          </>
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
              {isPending ? (
                <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
              ) : null}
              {step === 'card' || step === 'terms'
                ? 'Next'
                : !isPending
                  ? 'Get link'
                  : viewer.signedIn
                    ? 'Creating link…'
                    : 'Saving…'}
            </Button>
          </DialogFooter>
        </>
      )}
    </>
  );
}

function StepHeader({
  title,
  description,
  progress,
  onBack,
  backDisabled,
}: {
  title: string;
  description?: string;
  progress?: number;
  onBack: () => void;
  backDisabled: boolean;
}) {
  return (
    <>
      <DialogHeader>
        {/* The back arrow shares the title row rather than sitting above it: one line
            of chrome, and the title says where you are. */}
        <div className="flex items-center gap-snug">
          <button
            type="button"
            onClick={onBack}
            disabled={backDisabled}
            aria-label="Back"
            className="-ml-1.5 grid size-8 shrink-0 place-items-center rounded-full border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:border-iris disabled:opacity-50"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
          </button>
          <DialogTitle className="min-w-0 flex-1">{title}</DialogTitle>
          {progress ? (
            <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
              Step {progress} of 3
            </span>
          ) : null}
        </div>
        {description ? (
          <DialogDescription>{description}</DialogDescription>
        ) : (
          <DialogDescription className="sr-only">{title}</DialogDescription>
        )}
      </DialogHeader>
      {/* OUTSIDE THE HEADER, which keeps `pr-12` clear of the close button. The bar
          measures the whole form, so it spans the same width as the fields below it. */}
      {progress ? (
        <div className="grid grid-cols-3 gap-tight" aria-hidden>
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={n <= progress ? 'h-1 rounded-full bg-primary' : 'h-1 rounded-full bg-muted'}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function DraftPreview({ card, line }: { card: UnlistedItemDraft; line: string | null }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    const first = card.images[0];
    if (!first) return;
    const url = URL.createObjectURL(first);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [card.images]);

  return (
    <div className="flex items-center gap-cozy rounded-lg border p-cozy">
      <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-muted">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="size-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 space-y-tight">
        <p className="truncate text-body font-medium">{deriveItemTitle(card.description)}</p>
        <p className="text-meta text-muted-foreground">
          {[card.condition, card.category].filter(Boolean).join(' · ')}
        </p>
        {line ? <p className="line-clamp-2 text-body text-muted-foreground">{line}</p> : null}
      </div>
    </div>
  );
}

function NextSteps({ items }: { items: string[] }) {
  return (
    <ol className="grid gap-snug">
      {items.map((item, index) => (
        <li key={item} className="flex items-center gap-snug">
          <span
            aria-hidden
            className={
              index === items.length - 1
                ? 'grid size-5 shrink-0 place-items-center rounded-full bg-primary text-meta font-semibold text-primary-foreground'
                : 'grid size-5 shrink-0 place-items-center rounded-full bg-muted text-meta font-semibold text-muted-foreground'
            }
          >
            {index + 1}
          </span>
          <span className="text-body text-muted-foreground">{item}</span>
        </li>
      ))}
    </ol>
  );
}
