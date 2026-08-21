'use client';

// components/trade/TradeNegotiationPanel.tsx
//
// Negotiation controls for a Trade in state NEGOTIATING, rendered inside the
// contract room's action card.
//
// This is the surface that made the private-deal flow redundant. Previously an
// offer could only be answered with Decline or Accept from an inbox card, and a
// counter replaced the whole proposal with a new row, so there was nowhere to
// discuss and no continuous history. Now the room exists from the first offer:
// the terms on the table, who has accepted them, the chat, and Accept /
// Change cash (listing owner) / Decline all sit in one place. Handover is
// edited on the Terms row by either trader and does not reset acceptances.
//
// The controls offered are decided by `availableActions`, not by this component —
// the same rule ActionBar follows.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

import { ContractOverflowMenu } from '@/components/contract/ContractActionCard';
import { Button } from '@/components/ui/button';
import { SavedCardRow } from '@/components/payments/SavedCardRow';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ReportDialog } from '@/components/reports/ReportDialog';
import { availableActions } from '@/domain/state-machine/actions';
import type { TradeViewerContext } from '@/domain/state-machine/types';
import {
  acceptTradeTerms,
  declineTradeOffer,
  proposeTradeTerms,
  type TradeNegotiationResult,
  type TradeTermsInput,
} from '@/lib/actions/tradeNegotiation';

export interface TradeNegotiationPanelProps {
  tradeId: string;
  viewer: TradeViewerContext;
  /** The other trader — used for the overflow Report action. */
  counterpartyId: string;
  counterpartyName: string;
  termsVersion: number;
  /** Current terms on the table. */
  terms: {
    cashAmountCents: number;
    cashDirection: 'PROPOSER_PAYS' | 'COUNTERPART_PAYS';
    handoverMethod: 'DELIVERY' | 'IN_PERSON' | null;
    meetingLocation: string | null;
    meetingLat: number | null;
    meetingLng: number | null;
    meetingPlaceId: string | null;
    meetingAt: string | null;
    deliveryDetails: string | null;
    deliveryCostCents: number | null;
    offerMessage: string | null;
    /**
     * What the counterpart is handing over out of a binder (0081). Non-null is what
     * MAKES this a binder trade, so it doubles as the flag: the field appears on the
     * counter form only for a trade that has one.
     */
    counterpartGoodsDescription: string | null;
  };
}

export function TradeNegotiationPanel({
  tradeId,
  viewer,
  counterpartyId,
  counterpartyName,
  termsVersion,
  terms,
}: TradeNegotiationPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [counterOpen, setCounterOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [hasCard, setHasCard] = useState(false);

  const [cash, setCash] = useState((terms.cashAmountCents / 100).toFixed(2));
  const [direction, setDirection] = useState(terms.cashDirection);
  const [note, setNote] = useState('');
  const isShopfrontTrade = terms.counterpartGoodsDescription !== null;
  const [counterpartGoods, setCounterpartGoods] = useState(
    terms.counterpartGoodsDescription ?? '',
  );
  const [error, setError] = useState<string | null>(null);

  const actions = availableActions('NEGOTIATING', viewer);

  function run(
    operation: () => Promise<TradeNegotiationResult>,
    success: string,
  ): Promise<boolean> {
    setError(null);
    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await operation();
        if (result.ok) {
          toast.success(
            result.collateralStarted ? 'Terms agreed. Collateral is being arranged.' : success,
          );
          setCounterOpen(false);
          setDeclineOpen(false);
          router.refresh();
          resolve(true);
        } else {
          const message = result.message ?? 'Something went wrong. Please try again.';
          setError(message);
          toast.error(message);
          resolve(false);
        }
      });
    });
  }

  function submitCounter() {
    const cents = Math.round(Number.parseFloat(cash || '0') * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError('Enter a valid cash amount.');
      return;
    }
    if (isShopfrontTrade && counterpartGoods.trim() === '') {
      setError('Say which cards are coming out of the listing.');
      return;
    }

    const payload: TradeTermsInput = {
      cashAmountCents: cents,
      cashDirection: direction,
      handoverMethod: terms.handoverMethod ?? 'DELIVERY',
      message: note,
      counterpartGoodsDescription: isShopfrontTrade ? counterpartGoods.trim() : null,
    };
    run(
      () => proposeTradeTerms(tradeId, termsVersion, payload),
      'Cash updated. They need to accept the new amount.',
    );
  }

  return (
    <>
      {/* Controls only. The terms themselves, the version and each side's
          acceptance all live in the room's detail rows and progress rail — showing
          them again here made the action card a summary with buttons attached
          instead of a place to act. Failures surface as toasts, and the counter
          form carries its own inline validation. */}
      <div className="flex w-full min-w-0 flex-col items-stretch gap-2 sm:items-end">
        <SavedCardRow className="w-full sm:max-w-sm" />
        <ContractOverflowMenu>
          {actions.includes('PROPOSE_TERMS') ? (
            <Button variant="ghost" disabled={isPending} onClick={() => setCounterOpen(true)}>
              Change cash
            </Button>
          ) : null}
          {actions.includes('DECLINE_OFFER') ? (
            <Button variant="ghost" disabled={isPending} onClick={() => setDeclineOpen(true)}>
              Decline
            </Button>
          ) : null}
          <ReportDialog
            targetType="user"
            targetId={counterpartyId}
            triggerLabel={`Report ${counterpartyName}`}
          />
        </ContractOverflowMenu>
        {actions.includes('ACCEPT_TERMS') ? (
          <Button
            disabled={isPending}
            aria-busy={isPending}
            aria-haspopup="dialog"
            onClick={() => setAcceptOpen(true)}
          >
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Accept terms
          </Button>
        ) : null}
      </div>

      <Dialog open={counterOpen} onOpenChange={setCounterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change cash</DialogTitle>
            <DialogDescription>
              Only you can set the cash on this trade. The other trader will need to
              accept the new amount. Meeting and postage are edited separately and do
              not reset anyone&apos;s accept.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-group py-group">
            {isShopfrontTrade ? (
              <div className="space-y-snug">
                <Label htmlFor="trade-counterpart-goods">Cards from the listing</Label>
                <Textarea
                  id="trade-counterpart-goods"
                  value={counterpartGoods}
                  onChange={(event) => setCounterpartGoods(event.target.value)}
                  maxLength={1000}
                  rows={3}
                  aria-describedby="trade-counterpart-goods-hint"
                />
                <p
                  id="trade-counterpart-goods-hint"
                  className="text-body text-muted-foreground"
                >
                  The listing is a binder or bulk lot, so this is the record of what is
                  being swapped. It is what an arbitrator reads if the trade goes wrong.
                </p>
              </div>
            ) : null}

            <div className="grid gap-cozy sm:grid-cols-2">
              <div className="space-y-snug">
                <Label htmlFor="trade-cash">Cash</Label>
                <MoneyInput
                  id="trade-cash"
                  value={cash}
                  onChange={(event) => setCash(event.target.value)}
                />
              </div>
              <div className="space-y-snug">
                <Label htmlFor="trade-direction">Who pays</Label>
                <Select
                  value={direction}
                  onValueChange={(value) => setDirection(value as typeof direction)}
                >
                  <SelectTrigger id="trade-direction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PROPOSER_PAYS">Proposer pays</SelectItem>
                    <SelectItem value="COUNTERPART_PAYS">Counterpart pays</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-snug">
              <Label htmlFor="trade-note">Note</Label>
              <Textarea
                id="trade-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Explain what you changed"
              />
            </div>
            {error ? (
              <p role="alert" className="text-body text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCounterOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={submitCounter} disabled={isPending} aria-busy={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Save cash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={acceptOpen}
        onOpenChange={(open) => {
          if (isPending) return;
          setAcceptOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept these terms?</DialogTitle>
            <DialogDescription>
              The last accept places a temporary Stripe card hold (not a charge)
              and may charge the trade fee. Replace the card here if you do not
              want this one used.
            </DialogDescription>
          </DialogHeader>
          <SavedCardRow inline onStatus={setHasCard} />
          <p className="text-body">
            <Link
              href="/help#holds"
              className="font-medium underline underline-offset-4 hover:text-foreground"
            >
              How holds and disputes work
            </Link>
          </p>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAcceptOpen(false)}
              disabled={isPending}
            >
              Back
            </Button>
            <Button
              type="button"
              disabled={isPending || !hasCard}
              aria-busy={isPending}
              onClick={() => {
                void run(
                  () => acceptTradeTerms(tradeId, termsVersion),
                  'Accepted. Waiting on the other trader.',
                ).then((ok) => {
                  if (ok) setAcceptOpen(false);
                });
              }}
            >
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Accept terms
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline this offer?</DialogTitle>
            <DialogDescription>
              The offer closes and nothing is charged. No collateral has been placed, so
              declining costs neither of you anything.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeclineOpen(false)} disabled={isPending}>
              Keep negotiating
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              aria-busy={isPending}
              onClick={() => run(() => declineTradeOffer(tradeId), 'Offer closed.')}
            >
              Decline offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
