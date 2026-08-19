'use client';

// components/admin/TradeDisputeActions.tsx
//
// Operator controls for resolving a disputed Trade (Req 7.2-7.5, 8.1-8.6).
//
// WHY THIS EXISTS. Trade dispute resolution used to be participant-gated. Either
// trader could call `reportFraud`, be treated as the victim unconditionally, and walk
// away with the counterparty's 100%-of-FMV collateral while their own hold was voided
// — no evidence, no review, no chance for the accused to answer. Participants now
// only raise a dispute or CLAIM fraud; the determination is made here.
//
// TWO OUTCOMES, and the fraud one demands an explicit choice of victim. There is no
// default and no pre-selection, deliberately: the claimant is shown as a claimant,
// not as the answer, because inferring the victim from whoever spoke is exactly the
// bug this replaces.

import { useState, useTransition } from 'react';
import { Loader2, Scale, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import { resolveTradeConditionDispute, resolveTradeFraud } from '@/lib/actions/admin';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { formatAud } from '@/lib/format';
import { cn } from '@/lib/utils';

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Your session has expired. Please sign in again.',
  'not-authorized': 'You are not authorized to resolve disputes.',
  'not-found': 'That trade no longer exists.',
  'persistence-error': 'The dispute could not be resolved.',
};

/** One side of the trade, as the operator needs to see them. */
export interface TradeDisputeParty {
  id: string;
  name: string;
  /** Collateral held against this trader, in cents. */
  bondCents: number;
}

export interface TradeDisputeActionsProps {
  tradeId: string;
  initiator: TradeDisputeParty;
  counterpart: TradeDisputeParty;
  /** Who alleged fraud, if anyone. Shown as an allegation, never pre-selected. */
  fraudClaimedById: string | null;
  frictionTaxCents: number;
}

export function TradeDisputeActions({
  tradeId,
  initiator,
  counterpart,
  fraudClaimedById,
  frictionTaxCents,
}: TradeDisputeActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [victimId, setVictimId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'CONDITION' | 'FRAUD' | null>(null);

  const parties = [initiator, counterpart];
  const victim = parties.find((p) => p.id === victimId) ?? null;
  const offender = victim ? parties.find((p) => p.id !== victim.id) ?? null : null;

  function resolveCondition() {
    startTransition(async () => {
      const result = await resolveTradeConditionDispute(tradeId);
      setConfirming(null);
      if (result.ok) {
        toast.success(`Resolved as a condition dispute. Trade is ${result.data.state}.`);
        return;
      }
      toast.error(result.message ?? ERROR_MESSAGES[result.error] ?? 'Resolution failed.');
    });
  }

  function resolveFraud() {
    if (!victimId) return;
    startTransition(async () => {
      const result = await resolveTradeFraud(tradeId, victimId);
      setConfirming(null);
      if (result.ok) {
        toast.success('Resolved as objective fraud. Collateral captured, victim paid, and account permanently banned.');
        return;
      }
      toast.error(result.message ?? ERROR_MESSAGES[result.error] ?? 'Resolution failed.');
    });
  }

  return (
    <div className="space-y-group rounded-lg border border-border bg-muted p-cozy">
      <p className="flex items-center gap-snug text-body font-medium">
        <Scale className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        Resolve this dispute
      </p>

      {fraudClaimedById ? (
        <p className="flex items-start gap-snug rounded-md border border-destructive/40 bg-destructive/10 p-snug text-body text-destructive">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {parties.find((p) => p.id === fraudClaimedById)?.name ?? 'A trader'} has
            alleged fraud. That is a claim, not a finding — decide it on the evidence.
          </span>
        </p>
      ) : null}

      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          aria-haspopup="dialog"
          onClick={() => setConfirming('CONDITION')}
        >
          {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Resolve as condition dispute
        </Button>
        <p className="mt-1 text-body text-muted-foreground">
          Captures {formatAud(frictionTaxCents)} from the disputed-against trader and
          releases the rest. The trade completes.
        </p>
      </div>

      <div className="space-y-snug border-t border-border pt-cozy">
        <Label className="text-body">Or resolve as objective fraud — who was defrauded?</Label>
        <div className="flex flex-wrap gap-snug">
          {parties.map((party) => {
            const selected = victimId === party.id;
            return (
              <button
                key={party.id}
                type="button"
                disabled={isPending}
                aria-pressed={selected}
                onClick={() => setVictimId(selected ? null : party.id)}
                className={cn(
                  'rounded-md border px-cozy py-1.5 text-left text-body transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                  selected
                    ? 'border-primary bg-primary/10 font-semibold text-foreground'
                    : 'border-border text-foreground/85 hover:bg-muted',
                )}
              >
                <span className="block">{party.name}</span>
                <span className="block text-muted-foreground">
                  holds {formatAud(party.bondCents)}
                </span>
              </button>
            );
          })}
        </div>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={isPending || !victimId}
          aria-haspopup="dialog"
          onClick={() => setConfirming('FRAUD')}
        >
          Resolve as fraud
        </Button>
        <p className="text-body text-muted-foreground">
          Captures the other trader&apos;s collateral in full and pays it to whoever you
          select. Terminal and irreversible.
        </p>
      </div>

      {confirming === 'CONDITION' ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          title="Resolve as a condition dispute?"
          description={`${formatAud(frictionTaxCents)} is captured from the disputed-against trader and the remaining collateral is released. This moves real money and cannot be undone.`}
          confirmLabel="Resolve"
          pending={isPending}
          onConfirm={resolveCondition}
        />
      ) : null}

      {confirming === 'FRAUD' && victim && offender ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          title="Resolve as objective fraud?"
          // Names both sides explicitly. An operator about to move a four-figure sum
          // should have to read who loses it, not just who gains.
          description={`${formatAud(offender.bondCents)} will be captured from ${offender.name} and paid to ${victim.name}, whose own collateral is released. The trade becomes terminal and ${offender.name}'s account is permanently banned. This cannot be undone.`}
          confirmLabel={`Capture from ${offender.name}`}
          confirmVariant="destructive"
          pending={isPending}
          onConfirm={resolveFraud}
        />
      ) : null}
    </div>
  );
}
