'use client';

// components/deals/DealSteps.tsx
//
// The three steps of a private deal — Card, Terms, Review — shared by the composer
// (`DealComposeForm`) and the editor (`DealEditDialog`), so the host edits a deal in
// the same shape they built it. Each caller keeps its own state machine and its own
// final action (Get link vs Save changes); the step bodies, the header with its
// "Step N of 3" counter, and the presence rules behind the disabled Next live here
// once.

import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';

import { SaleTermsBreakdown, TradeTermsBreakdown } from '@/components/deals/DealTermsBreakdown';
import {
  UnlistedCategoryConditionFields,
  UnlistedDescriptionField,
  UnlistedPhotoField,
  UnlistedTitleField,
  unlistedDraftGap,
  type UnlistedItemDraft,
} from '@/components/trade/UnlistedItemFields';
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { StepProgress } from '@/components/ui/step-progress';
import { Textarea } from '@/components/ui/textarea';
import { dollarsToCents } from '@/domain/deals/dealInvite';
import { platformFeeCentsFor } from '@/domain/orchestrator/cashSaleOrchestrator';
import { deriveItemTitle } from '@/domain/validation';
import { formatMoney, itemImageUrl } from '@/lib/format';

/** The three steps the progress bar counts. */
export type DealStepName = 'card' | 'terms' | 'review';

/** Each counted step's position in "Step N of 3". */
export const DEAL_STEP_PROGRESS = { card: 1, terms: 2, review: 3 } as const;

/** The progress bar's step names; the deal's bar is decorative, so they are not shown. */
const DEAL_STEP_LABELS = ['Card', 'Terms', 'Review'] as const;

/**
 * What a deal step still needs, or `null` when it is complete. Drives the line
 * beside the action AND the button's disabled state, so the two cannot disagree.
 * Presence only — range rules come back as messages on Next.
 */
export function dealStepGap(
  step: DealStepName,
  {
    card,
    selling,
    priceCents,
    wanted,
    valueCents,
  }: {
    card: UnlistedItemDraft;
    selling: boolean;
    priceCents: number | null;
    wanted: string;
    valueCents: number | null;
  },
): string | null {
  if (step === 'card') return unlistedDraftGap(card);
  if (step === 'terms') {
    if (selling) return priceCents == null ? 'Enter a price.' : null;
    if (wanted.trim() === '') return 'Say what you want for it.';
    if (valueCents == null || valueCents < 1) return 'Say what your card is worth.';
  }
  return null;
}

/**
 * The step title row: an optional back arrow, the title, and "Step N of 3" when the
 * step is counted, with the progress bar beneath. Omit `onBack` where there is
 * nowhere to go back to — the dialog's own close button already exits.
 */
export function StepHeader({
  title,
  description,
  progress,
  onBack,
  backDisabled = false,
}: {
  title: string;
  description?: string;
  progress?: number;
  onBack?: () => void;
  backDisabled?: boolean;
}) {
  return (
    <>
      <DialogHeader>
        {/* The back arrow shares the title row rather than sitting above it: one line
            of chrome, and the title says where you are. */}
        <div className="flex items-center gap-snug">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              disabled={backDisabled}
              aria-label="Back"
              className="-ml-1.5 grid size-8 shrink-0 place-items-center rounded-full border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:border-iris disabled:opacity-50"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
            </button>
          ) : null}
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
      {progress ? <StepProgress steps={DEAL_STEP_LABELS} current={progress} /> : null}
    </>
  );
}

/** Step 1: the card — photos first, then what it is, category and condition. */
export function DealCardStep({
  card,
  onCard,
  selling,
  idPrefix,
}: {
  card: UnlistedItemDraft;
  onCard: (next: UnlistedItemDraft) => void;
  selling: boolean;
  idPrefix: string;
}) {
  return (
    <>
      <UnlistedPhotoField draft={card} onChange={onCard} idPrefix={idPrefix} />
      <UnlistedTitleField draft={card} onChange={onCard} idPrefix={idPrefix} />
      <UnlistedDescriptionField
        draft={card}
        onChange={onCard}
        idPrefix={idPrefix}
        label={selling ? 'What are you selling?' : 'What are you swapping?'}
        placeholder="Condition details, grade, anything they should know."
      />
      <UnlistedCategoryConditionFields draft={card} onChange={onCard} idPrefix={idPrefix} />
    </>
  );
}

/** Step 2: the price (sell), or what you want and what yours is worth (trade). */
export function DealTermsStep({
  selling,
  idPrefix,
  currency,
  priceDollars,
  onPriceDollars,
  wanted,
  onWanted,
  valueDollars,
  onValueDollars,
}: {
  selling: boolean;
  idPrefix: string;
  currency: string;
  priceDollars: string;
  onPriceDollars: (value: string) => void;
  wanted: string;
  onWanted: (value: string) => void;
  valueDollars: string;
  onValueDollars: (value: string) => void;
}) {
  if (selling) {
    return (
      <>
        <div className="space-y-snug">
          <Label htmlFor={`${idPrefix}-price`}>Price</Label>
          <MoneyInput
            id={`${idPrefix}-price`}
            size="lg"
            min="0.01"
            value={priceDollars}
            onChange={(event) => onPriceDollars(event.target.value)}
          />
        </div>
        <SaleTermsBreakdown priceCents={dollarsToCents(priceDollars)} currency={currency} />
        <p className="text-meta text-muted-foreground">
          Postage or a meetup is agreed in the deal room.
        </p>
      </>
    );
  }
  return (
    <>
      <div className="space-y-snug">
        <Label htmlFor={`${idPrefix}-wanted`}>What do you want for it?</Label>
        <Textarea
          id={`${idPrefix}-wanted`}
          value={wanted}
          onChange={(event) => onWanted(event.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="The card, set or grade they should put up."
          className="resize-none"
        />
      </div>
      <div className="space-y-snug">
        <Label htmlFor={`${idPrefix}-value`}>What is your card worth?</Label>
        <MoneyInput
          id={`${idPrefix}-value`}
          size="lg"
          min="0.01"
          value={valueDollars}
          onChange={(event) => onValueDollars(event.target.value)}
        />
      </div>
      <TradeTermsBreakdown valueCents={dollarsToCents(valueDollars)} currency={currency} />
    </>
  );
}

/** Step 3: the invite as they will see it, and what happens next. */
export function DealReviewStep({
  card,
  selling,
  priceCents,
  wanted,
  currency,
}: {
  card: UnlistedItemDraft;
  selling: boolean;
  priceCents: number | null;
  wanted: string;
  currency: string;
}) {
  return (
    <>
      <div className="space-y-snug">
        <p className="text-meta text-muted-foreground">What they will see</p>
        <DraftPreview
          card={card}
          line={
            selling
              ? priceCents
                ? `They pay ${formatMoney(priceCents + platformFeeCentsFor(priceCents, currency), currency)}`
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
  );
}

function DraftPreview({ card, line }: { card: UnlistedItemDraft; line: string | null }) {
  // Kept photos come first in the strip, so an edit's existing first photo leads.
  // Only a new upload needs an object URL.
  const keptUrl = itemImageUrl(card.keptPaths[0]);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    const first = card.images[0];
    if (!first) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(first);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [card.images]);
  const thumb = keptUrl ?? objectUrl;

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
