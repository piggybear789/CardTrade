'use client';

// components/admin/DealDisputeActions.tsx
//
// Arbitrator controls for resolving a disputed private deal.
//
// WHY THIS SCREEN MATTERS. `raiseDealDispute` was a one-way door: a binding deal went
// to DISPUTED and nothing anywhere read that state again. The cash authorisation stayed
// HELD and both collateral holds stayed ACTIVE, while the deal room told the parties
// their dispute was being reviewed. Because card authorisations lapse in about seven
// days, the escrow expired on its own — so the party in the wrong got their collateral
// back simply by waiting, and the party in the right got nothing.
//
// THE CASH IS AN AUTHORISATION, NOT A BALANCE, and the copy here says so. A deal's cash
// is only captured when both parties mark it complete, which by definition has not
// happened. So "refund the payer" moves no money at all — it releases a hold — and a
// split captures the arbitrated share and lets the provider release the remainder. That
// is a genuinely stronger position than a cash sale, where the money is already
// collected and has to be actively sent back.
//
// COLLATERAL IS RELEASED IN EVERY OUTCOME, stated on the screen so an arbitrator does
// not go looking for a penalty control that deliberately does not exist. A deal has no
// Friction_Tax and no fraud finding; capturing a party's collateral here would impose a
// penalty the parties were never told about when they posted it.

import { useState, useTransition } from 'react';
import { Loader2, Scale, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import { resolveDealDispute } from '@/lib/actions/admin';
import type { DealDisputeOutcome } from '@/domain/deal/dealDispute';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatAud } from '@/lib/format';

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Your session has expired. Please sign in again.',
  'not-authorized': 'You are not authorized to resolve disputes.',
  'not-found': 'That deal no longer exists.',
  'persistence-error': 'The dispute could not be resolved.',
};

export interface DealDisputeActionsProps {
  dealId: string;
  /** The uncaptured cash authorisation the outcome decides. Zero for a goods swap. */
  cashHeldCents: number;
  payerName: string | null;
  recipientName: string | null;
  /** Collateral frozen per party, released whichever way this goes. */
  collateral: readonly { id: string; name: string; amountCents: number }[];
  /** A previous provider refusal, if any. Retrying is safe. */
  cashError: string | null;
}

export function DealDisputeActions({
  dealId,
  cashHeldCents,
  payerName,
  recipientName,
  collateral,
  cashError,
}: DealDisputeActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [splitDollars, setSplitDollars] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState<DealDisputeOutcome | null>(null);

  const splitCents = Math.round(Number.parseFloat(splitDollars || '0') * 100);
  const splitValid =
    cashHeldCents > 0 &&
    Number.isFinite(splitCents) &&
    splitCents > 0 &&
    splitCents < cashHeldCents;

  const payer = payerName ?? 'the payer';
  const recipient = recipientName ?? 'the recipient';
  const collateralTotal = collateral.reduce((sum, c) => sum + c.amountCents, 0);

  /** Plain-language money effect, shown before the arbitrator commits. */
  function effectOf(outcome: DealDisputeOutcome): string {
    const collateralLine =
      collateralTotal > 0
        ? ` All collateral (${formatAud(collateralTotal)} across ${collateral.length} ${collateral.length === 1 ? 'party' : 'parties'}) is released.`
        : '';

    if (cashHeldCents === 0) {
      // Goods-for-goods. Being explicit that nothing moves matters more here than
      // anywhere else, because the buttons imply money and there is none.
      return outcome === 'REFUND_PAYER'
        ? `This deal has no cash component, so no money moves either way. The deal is recorded as unwound.${collateralLine}`
        : `This deal has no cash component, so no money moves either way. The deal is recorded as standing.${collateralLine}`;
    }

    switch (outcome) {
      case 'REFUND_PAYER':
        return `${payer}'s ${formatAud(cashHeldCents)} authorisation is released — they are never charged, because the deal's cash was held rather than collected. ${recipient} receives nothing and the deal is unwound.${collateralLine}`;
      case 'SPLIT':
        return `${formatAud(splitCents)} is charged to ${payer} and paid to ${recipient}; the remaining ${formatAud(cashHeldCents - splitCents)} authorisation is released. The deal completes on those adjusted terms.${collateralLine}`;
      case 'RELEASE_RECIPIENT':
        return `${formatAud(cashHeldCents)} is charged to ${payer} and paid to ${recipient}, as originally agreed. The deal completes.${collateralLine}`;
    }
  }

  function resolve(outcome: DealDisputeOutcome) {
    startTransition(async () => {
      const result = await resolveDealDispute(
        dealId,
        outcome,
        outcome === 'SPLIT' ? splitCents : undefined,
        note.trim() || undefined,
      );
      setConfirming(null);
      if (result.ok) {
        toast.success(
          result.data.capturedCents > 0
            ? `Resolved. ${formatAud(result.data.capturedCents)} charged, ${formatAud(result.data.releasedCents)} released.`
            : 'Resolved. Nothing was charged and every hold was released.',
        );
        return;
      }
      toast.error(result.message ?? ERROR_MESSAGES[result.error] ?? 'Resolution failed.');
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border/70 bg-muted/30 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Scale className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        Resolve this dispute
      </p>

      {cashError ? (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            A previous attempt was refused by the provider: {cashError} Retrying is safe
            — the authorisation is either still live or already gone, and neither state
            can be charged twice.
          </span>
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {cashHeldCents > 0
          ? `${formatAud(cashHeldCents)} is authorised on ${payer}'s card but not yet taken — a deal's cash is only captured when both parties mark it complete.`
          : 'This deal has no cash component. Only the record of what happened changes.'}
        {collateralTotal > 0
          ? ` ${formatAud(collateralTotal)} of collateral is frozen and will be released whichever way you decide: a deal has no penalty capture.`
          : ''}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={isPending}
          aria-haspopup="dialog"
          onClick={() => setConfirming('REFUND_PAYER')}
        >
          {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Unwind the deal
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          aria-haspopup="dialog"
          onClick={() => setConfirming('RELEASE_RECIPIENT')}
        >
          Uphold as agreed
        </Button>
      </div>

      {cashHeldCents > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0">
            <Label htmlFor={`split-${dealId}`} className="text-xs">
              Adjusted price (AUD)
            </Label>
            <Input
              id={`split-${dealId}`}
              inputMode="decimal"
              value={splitDollars}
              onChange={(event) => setSplitDollars(event.target.value)}
              placeholder="0.00"
              className="mt-1 h-9 w-32"
              aria-describedby={`split-help-${dealId}`}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending || !splitValid}
            aria-haspopup="dialog"
            onClick={() => setConfirming('SPLIT')}
          >
            Complete on adjusted terms
          </Button>
          <p id={`split-help-${dealId}`} className="w-full text-xs text-muted-foreground">
            What {recipient} keeps. Must be more than zero and less than the{' '}
            {formatAud(cashHeldCents)} held — use unwind or uphold for those.
          </p>
        </div>
      ) : null}

      <div>
        <Label htmlFor={`note-${dealId}`} className="text-xs">
          Note to both parties (optional)
        </Label>
        <Textarea
          id={`note-${dealId}`}
          value={note}
          rows={3}
          maxLength={2_000}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What you found and why. Unlike a case note, this is shown to both parties."
          className="mt-1"
          disabled={isPending}
        />
      </div>

      {confirming ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          title="Resolve this dispute?"
          description={`${effectOf(confirming)} This cannot be undone from here.`}
          confirmLabel="Resolve"
          confirmVariant={confirming === 'REFUND_PAYER' ? 'destructive' : 'default'}
          pending={isPending}
          onConfirm={() => resolve(confirming)}
        />
      ) : null}
    </div>
  );
}
