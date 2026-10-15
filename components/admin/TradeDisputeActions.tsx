'use client';

// components/admin/TradeDisputeActions.tsx
//
// Operator controls for resolving a disputed Trade (Req 7.2-7.5, 8.1-8.6; ESC-01,
// ESC-10, ESC-23; design §1.2 "Admin UI").
//
// WHY THIS EXISTS. Trade dispute resolution used to be participant-gated: either
// trader could call `reportFraud` and be paid the other's collateral with no review.
// Participants now only raise a dispute or CLAIM fraud; the decision is made here.
//
// NOTHING IS CAPTURED UNTIL STAFF DECIDE (ESC-01). The old flow took $20 the moment a
// member pressed "Raise a problem", which made Stripe release the rest of the hold and
// left a later fraud finding nothing to capture. The four outcomes below are the only
// place collateral moves:
//
//   * Unfounded    — both temporary card holds are released; the trade completes.
//   * Condition    — staff choose compensation for the wronged trader, up to what the
//                    accused's collateral can still pay (`remainingCents`).
//   * Fraud        — the offender's collateral pays the victim (after the 7-day safety
//                    hold); the offender is banned. Victim chosen explicitly, never
//                    pre-selected from whoever complained.
//   * No exchange  — only on a trade that never reached inspection: everything is
//                    released, fees refunded, listings restored.
//
// On a never-inspected trade, Unfounded and Condition require staff to attest the
// goods changed hands: otherwise a no-show could file first and have the other side's
// cash released (round-3 review #1).

import { useState, useTransition } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ScaleIcon, ShieldAlertIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { resolveTradeDispute, setDisputeCustodyScope } from '@/lib/actions/admin';
import type { TradeResolutionParty } from '@/lib/actions/arbitration';
import type { TradeDisputeOutcome } from '@/domain/orchestrator/disputeResolution';
import { minorUnitDigits } from '@/domain/region/regions';
import { Button } from '@/components/ui/button';
import { PendingLabel } from '@/components/ui/pending-label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { formatContractDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Your session has expired. Please sign in again.',
  'not-authorized': 'You are not authorized to resolve disputes.',
  'not-found': 'That trade no longer exists.',
  'persistence-error': 'The dispute could not be resolved.',
};

/** @deprecated alias kept for callers; the console now receives the full party. */
export type TradeDisputeParty = TradeResolutionParty;

export interface TradeDisputeActionsProps {
  tradeId: string;
  initiator: TradeResolutionParty;
  counterpart: TradeResolutionParty;
  /** Who alleged fraud, if anyone. Shown as an allegation, never pre-selected. */
  fraudClaimedById: string | null;
  /** Whether the trade ever reached INSPECTION (R4-M1). */
  inspected: boolean;
  /** Default condition compensation for this currency. */
  compensationDefaultCents: number;
  handoverMethod: 'IN_PERSON' | 'DELIVERY' | null;
  /** Staff narrowed the custody safeguard to this trader; null means both. */
  custodyAccusedId: string | null;
  /** ISO 4217 code every figure in this panel is denominated in. Required. */
  currency: string;
}

type Choice = 'UNFOUNDED' | 'CONDITION' | 'FRAUD' | 'NO_EXCHANGE';

const HOLD_STATE_LABEL: Record<TradeResolutionParty['holdState'], string> = {
  HELD: 'temporary card hold',
  CUSTODY: 'charged into safekeeping',
  LEGACY: 'partly charged (old dispute rule)',
  NONE: 'no collateral left',
};

/** Parse a major-unit string into minor units, or null when it is not a valid amount. */
function toMinor(value: string, currency: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 10 ** minorUnitDigits(currency));
}

function toMajor(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

export function TradeDisputeActions({
  tradeId,
  initiator,
  counterpart,
  fraudClaimedById,
  inspected,
  compensationDefaultCents,
  handoverMethod,
  custodyAccusedId,
  currency,
}: TradeDisputeActionsProps) {
  const money = (minorUnits: number) => formatMoney(minorUnits, currency);
  const [isPending, startTransition] = useTransition();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [compensation, setCompensation] = useState('');
  const [goodsChangedHands, setGoodsChangedHands] = useState(false);
  const [acknowledgeNoCollateral, setAcknowledgeNoCollateral] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [scopeAccused, setScopeAccused] = useState<string | null>(custodyAccusedId);

  const parties = [initiator, counterpart];
  const subject = parties.find((p) => p.id === subjectId) ?? null;
  const other = subject ? (parties.find((p) => p.id !== subject.id) ?? null) : null;

  // For CONDITION the subject is the WRONGED trader and `other` is the accused.
  // For FRAUD the subject is the VICTIM and `other` is the offender.
  const conditionMax = choice === 'CONDITION' && other ? other.remainingCents : 0;
  const compensationMinor = toMinor(compensation, currency);
  const offenderUnbacked =
    choice === 'FRAUD' && other ? other.holdState === 'NONE' || other.holdState === 'LEGACY' : false;
  const needsAttestation = !inspected && (choice === 'UNFOUNDED' || choice === 'CONDITION');

  function pick(next: Choice) {
    setChoice(next);
    setSubjectId(null);
    setGoodsChangedHands(false);
    setAcknowledgeNoCollateral(false);
    setCompensation('');
  }

  function pickSubject(id: string) {
    setSubjectId(id);
    if (choice === 'CONDITION') {
      const accused = parties.find((p) => p.id !== id);
      const ceiling = accused?.remainingCents ?? 0;
      setCompensation(toMajor(Math.min(compensationDefaultCents, ceiling), currency));
    }
  }

  const outcome: TradeDisputeOutcome | null = (() => {
    if (choice === 'UNFOUNDED') return { kind: 'UNFOUNDED', goodsChangedHands };
    if (choice === 'NO_EXCHANGE') return { kind: 'NO_EXCHANGE' };
    if (choice === 'CONDITION' && subject && compensationMinor !== null && compensationMinor <= conditionMax) {
      return { kind: 'CONDITION', wrongedTraderId: subject.id, compensationMinor, goodsChangedHands };
    }
    if (choice === 'FRAUD' && subject) {
      return { kind: 'FRAUD', victimId: subject.id, acknowledgeNoCollateral: offenderUnbacked && acknowledgeNoCollateral };
    }
    return null;
  })();

  const ready =
    outcome !== null &&
    (!needsAttestation || goodsChangedHands) &&
    (!offenderUnbacked || acknowledgeNoCollateral);

  function resolve() {
    if (!outcome) return;
    startTransition(async () => {
      const result = await resolveTradeDispute(tradeId, outcome);
      setConfirming(false);
      if (result.ok) {
        toast.success(
          result.data.manualReconciliation
            ? 'Resolved. Some money needs a manual follow-up; the case is flagged.'
            : 'Dispute resolved.',
        );
        return;
      }
      toast.error(result.message ?? ERROR_MESSAGES[result.error] ?? 'Resolution failed.');
    });
  }

  function saveScope(nextAccused: string | null) {
    startTransition(async () => {
      const result = await setDisputeCustodyScope(tradeId, nextAccused);
      if (result.ok) {
        setScopeAccused(nextAccused);
        toast.success(nextAccused ? 'The safeguard now applies to one trader.' : 'The safeguard applies to both traders.');
        return;
      }
      toast.error(result.message ?? ERROR_MESSAGES[result.error] ?? 'Could not change the safeguard.');
    });
  }

  const confirmCopy = (() => {
    if (!outcome) return '';
    switch (outcome.kind) {
      case 'UNFOUNDED':
        return 'Both temporary card holds are released and the trade completes. Nothing is charged.';
      case 'NO_EXCHANGE':
        return 'The trade is cancelled as if it never happened: both temporary card holds are released, both fees are refunded and the listings go back on sale.';
      case 'CONDITION':
        return `${money(outcome.compensationMinor)} is charged from ${other?.name ?? 'the other trader'}'s collateral and paid to ${subject?.name ?? 'the wronged trader'} after the 7-day safety hold. The rest of the collateral is released and the trade completes. This moves real money and cannot be undone.`;
      case 'FRAUD':
        return outcome.acknowledgeNoCollateral
          ? `${other?.name ?? 'The offender'} has no collateral left to charge. The fraud finding is recorded and their account is permanently banned; any goodwill payment to ${subject?.name ?? 'the victim'} is a separate staff decision. This cannot be undone.`
          : `${money(other?.remainingCents ?? 0)} will be charged from ${other?.name ?? 'the offender'} and paid to ${subject?.name ?? 'the victim'} after the 7-day safety hold, whose own collateral is released. ${other?.name ?? 'The offender'}'s account is permanently banned. This cannot be undone.`;
    }
  })();

  return (
    <div className="space-y-group rounded-lg border border-border bg-muted p-cozy">
      <p className="flex items-center gap-snug text-body font-medium">
        <HugeiconsIcon icon={ScaleIcon} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        Resolve this dispute
      </p>

      {fraudClaimedById ? (
        <p className="flex items-start gap-snug rounded-md border border-destructive/40 bg-destructive/10 p-snug text-body text-destructive">
          <HugeiconsIcon icon={ShieldAlertIcon} className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {parties.find((p) => p.id === fraudClaimedById)?.name ?? 'A trader'} has
            alleged fraud. That is a claim, not a finding — decide it on the evidence.
          </span>
        </p>
      ) : null}

      <dl className="grid gap-tight text-body sm:grid-cols-2" aria-label="Collateral on this trade">
        {parties.map((party) => (
          <div key={party.id} className="rounded-md border border-border bg-background p-snug">
            <dt className="font-medium">{party.name}</dt>
            <dd className="text-muted-foreground">
              {money(party.remainingCents)} available · {HOLD_STATE_LABEL[party.holdState]}
            </dd>
            {party.holdState === 'HELD' && party.holdExpiresAt ? (
              <dd className="text-muted-foreground">
                Hold expires {formatContractDateTime(party.holdExpiresAt) ?? party.holdExpiresAt}
              </dd>
            ) : null}
            {handoverMethod === 'DELIVERY' ? (
              <dd className="text-muted-foreground" data-testid={`received-${party.id}`}>
                {party.receivedAt
                  ? `Confirmed receipt ${formatContractDateTime(party.receivedAt) ?? party.receivedAt}`
                  : 'Has not confirmed receipt'}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
      {handoverMethod === 'DELIVERY' ? (
        <p className="text-body text-muted-foreground">
          If one card arrived, use Condition or Fraud for the side that didn&apos;t.
        </p>
      ) : null}

      <fieldset className="space-y-snug">
        <legend className="text-body font-medium">Outcome</legend>
        <div className="flex flex-wrap gap-snug">
          {(
            [
              ['UNFOUNDED', 'Unfounded'],
              ['CONDITION', 'Condition'],
              ['FRAUD', 'Fraud'],
              ...(inspected ? [] : ([['NO_EXCHANGE', "The exchange didn't happen: undo the trade"]] as const)),
            ] as ReadonlyArray<readonly [Choice, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={isPending}
              aria-pressed={choice === value}
              onClick={() => pick(value)}
              className={cn(
                'rounded-md border px-cozy py-1.5 text-left text-body transition-colors focus:outline-none focus-visible:border-ring disabled:opacity-60',
                choice === value
                  ? 'border-border bg-accent font-semibold text-accent-foreground'
                  : 'border-border text-foreground/85 hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      {choice === 'CONDITION' || choice === 'FRAUD' ? (
        <div className="space-y-snug">
          <Label className="text-body">
            {choice === 'CONDITION' ? 'Who was wronged?' : 'Who was defrauded?'}
          </Label>
          <div className="flex flex-wrap gap-snug">
            {parties.map((party) => (
              <button
                key={party.id}
                type="button"
                disabled={isPending}
                aria-pressed={subjectId === party.id}
                onClick={() => pickSubject(party.id)}
                className={cn(
                  'rounded-md border px-cozy py-1.5 text-left text-body transition-colors focus:outline-none focus-visible:border-ring disabled:opacity-60',
                  subjectId === party.id
                    ? 'border-border bg-accent font-semibold text-accent-foreground'
                    : 'border-border text-foreground/85 hover:bg-muted',
                )}
              >
                {party.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {choice === 'CONDITION' && subject && other ? (
        <div className="space-y-tight">
          <Label htmlFor={`compensation-${tradeId}`} className="text-body">
            Compensation from {other.name}
          </Label>
          <MoneyInput
            id={`compensation-${tradeId}`}
            value={compensation}
            max={toMajor(conditionMax, currency)}
            onChange={(event) => setCompensation(event.target.value)}
            aria-describedby={`compensation-hint-${tradeId}`}
          />
          <p id={`compensation-hint-${tradeId}`} className="text-body text-muted-foreground">
            Up to {money(conditionMax)}. Use a higher amount when the card sent is worth
            much less than the one agreed; a token amount when the difference is minor.
          </p>
          {compensationMinor !== null && compensationMinor > conditionMax ? (
            <p className="text-body text-destructive">That is more than the collateral can pay.</p>
          ) : null}
        </div>
      ) : null}

      {choice === 'FRAUD' && subject && other ? (
        <div className="space-y-tight text-body text-muted-foreground">
          <p>
            Fraud is for goods that were never sent, counterfeits or a deliberate swap. A
            card in worse condition than described is a condition dispute.
          </p>
          {offenderUnbacked ? (
            <label className="flex items-start gap-snug text-foreground">
              <input
                type="checkbox"
                className="mt-1"
                checked={acknowledgeNoCollateral}
                onChange={(event) => setAcknowledgeNoCollateral(event.target.checked)}
              />
              <span>No collateral left: confirm fraud anyway</span>
            </label>
          ) : null}
        </div>
      ) : null}

      {needsAttestation ? (
        <label className="flex items-start gap-snug text-body">
          <input
            type="checkbox"
            className="mt-1"
            checked={goodsChangedHands}
            onChange={(event) => setGoodsChangedHands(event.target.checked)}
          />
          <span>
            The goods did change hands
            <span className="block text-muted-foreground">
              Neither trader confirmed the handover, so nothing on record shows the cards
              were swapped. Tick this only if the evidence shows they were.
            </span>
          </span>
        </label>
      ) : null}

      <Button
        type="button"
        size="sm"
        variant={choice === 'FRAUD' ? 'destructive' : 'default'}
        disabled={isPending || !ready}
        aria-haspopup="dialog"
        onClick={() => setConfirming(true)}
      >
        <PendingLabel pending={isPending}>Resolve</PendingLabel>
      </Button>

      <div className="space-y-tight border-t border-border pt-cozy">
        <Label htmlFor={`scope-${tradeId}`} className="text-body">
          Limit safeguard to one trader
        </Label>
        <p className="text-body text-muted-foreground">
          While the case is open, any temporary card hold close to expiring is charged
          into safekeeping so it cannot lapse. By default this covers both traders.
        </p>
        <select
          id={`scope-${tradeId}`}
          className="h-9 rounded-md border border-border bg-background px-snug text-body"
          value={scopeAccused ?? ''}
          disabled={isPending}
          onChange={(event) => saveScope(event.target.value || null)}
        >
          <option value="">Both traders</option>
          {parties.map((party) => (
            <option key={party.id} value={party.id}>
              Only {party.name}
            </option>
          ))}
        </select>
      </div>

      {confirming && outcome ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(false);
          }}
          title="Resolve this dispute?"
          description={confirmCopy}
          confirmLabel="Resolve"
          confirmVariant={outcome.kind === 'FRAUD' ? 'destructive' : undefined}
          pending={isPending}
          onConfirm={resolve}
        />
      ) : null}
    </div>
  );
}
