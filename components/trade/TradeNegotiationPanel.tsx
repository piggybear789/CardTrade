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
// the terms on the table, who has accepted them, the chat, and Accept / Counter /
// Decline all sit in one place.
//
// The controls offered are decided by `availableActions`, not by this component —
// the same rule ActionBar follows.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
import { PlacePicker } from '@/components/location';
import type { PlaceValue } from '@/lib/location/types';
import { availableActions } from '@/domain/state-machine/actions';
import type { TradeViewerContext } from '@/domain/state-machine/types';
import {
  acceptTradeTerms,
  declineTradeOffer,
  proposeTradeTerms,
  type TradeNegotiationResult,
  type TradeTermsInput,
} from '@/lib/actions/tradeNegotiation';

/** Only a provider-resolved place may become a contractual meeting point. */
function isResolvedPlace(place: PlaceValue | null): place is PlaceValue {
  return Boolean(
    place &&
      !place.placeId.startsWith('text:') &&
      !place.placeId.startsWith('legacy:') &&
      Number.isFinite(place.lat) &&
      Number.isFinite(place.lng),
  );
}

export interface TradeNegotiationPanelProps {
  tradeId: string;
  viewer: TradeViewerContext;
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
  };
}

export function TradeNegotiationPanel({
  tradeId,
  viewer,
  termsVersion,
  terms,
}: TradeNegotiationPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [counterOpen, setCounterOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);

  const [cash, setCash] = useState((terms.cashAmountCents / 100).toFixed(2));
  const [direction, setDirection] = useState(terms.cashDirection);
  const [method, setMethod] = useState<'DELIVERY' | 'IN_PERSON'>(
    terms.handoverMethod ?? 'DELIVERY',
  );
  const [place, setPlace] = useState<PlaceValue | null>(() =>
    terms.meetingLocation &&
    terms.meetingPlaceId &&
    terms.meetingLat != null &&
    terms.meetingLng != null
      ? {
          label: terms.meetingLocation,
          placeId: terms.meetingPlaceId,
          lat: terms.meetingLat,
          lng: terms.meetingLng,
          precision: 'exact',
        }
      : null,
  );
  const [meetingAt, setMeetingAt] = useState(
    terms.meetingAt ? terms.meetingAt.slice(0, 16) : '',
  );
  const [deliveryDetails, setDeliveryDetails] = useState(terms.deliveryDetails ?? '');
  const [deliveryCost, setDeliveryCost] = useState(
    ((terms.deliveryCostCents ?? 0) / 100).toFixed(2),
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const actions = availableActions('NEGOTIATING', viewer);

  function run(operation: () => Promise<TradeNegotiationResult>, success: string) {
    setError(null);
    startTransition(async () => {
      const result = await operation();
      if (result.ok) {
        toast.success(result.escrowStarted ? 'Terms agreed. Collateral is being arranged.' : success);
        setCounterOpen(false);
        setDeclineOpen(false);
        router.refresh();
      } else {
        const message = result.message ?? 'Something went wrong. Please try again.';
        setError(message);
        toast.error(message);
      }
    });
  }

  function submitCounter() {
    const cents = Math.round(Number.parseFloat(cash || '0') * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError('Enter a valid cash amount.');
      return;
    }
    if (method === 'IN_PERSON') {
      const when = meetingAt ? new Date(meetingAt) : null;
      if (!isResolvedPlace(place)) {
        setError('Choose a suggested meeting point.');
        return;
      }
      if (!when || !Number.isFinite(when.getTime()) || when.getTime() <= Date.now()) {
        setError('Choose a future meeting time.');
        return;
      }
    }
    const shippingCents = Math.round(Number.parseFloat(deliveryCost || '0') * 100);

    const payload: TradeTermsInput = {
      cashAmountCents: cents,
      cashDirection: direction,
      handoverMethod: method,
      meetingLocation: method === 'IN_PERSON' ? place!.label.trim() : null,
      meetingLat: method === 'IN_PERSON' ? place!.lat : null,
      meetingLng: method === 'IN_PERSON' ? place!.lng : null,
      meetingPlaceId: method === 'IN_PERSON' ? place!.placeId : null,
      meetingAt: method === 'IN_PERSON' ? new Date(meetingAt).toISOString() : null,
      deliveryDetails: method === 'DELIVERY' ? deliveryDetails : null,
      deliveryCostCents: method === 'DELIVERY' ? shippingCents : null,
      message: note,
    };
    run(
      () => proposeTradeTerms(tradeId, termsVersion, payload),
      'Counter offer sent. They need to accept the new terms.',
    );
  }

  return (
    <>
      {/* Controls only. The terms themselves, the version and each side's
          acceptance all live in the room's detail rows and progress rail — showing
          them again here made the action card a summary with buttons attached
          instead of a place to act. Failures surface as toasts, and the counter
          form carries its own inline validation. */}
      <div className="flex flex-wrap gap-2">
        {actions.includes('ACCEPT_TERMS') ? (
          <Button
            disabled={isPending}
            aria-busy={isPending}
            onClick={() =>
              run(
                () => acceptTradeTerms(tradeId, termsVersion),
                'Accepted. Waiting on the other trader.',
              )
            }
          >
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Accept terms
          </Button>
        ) : null}
        {actions.includes('PROPOSE_TERMS') ? (
          <Button variant="outline" disabled={isPending} onClick={() => setCounterOpen(true)}>
            Counter
          </Button>
        ) : null}
        {actions.includes('DECLINE_OFFER') ? (
          <Button variant="ghost" disabled={isPending} onClick={() => setDeclineOpen(true)}>
            Decline
          </Button>
        ) : null}
      </div>

      <Dialog open={counterOpen} onOpenChange={setCounterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Counter offer</DialogTitle>
            <DialogDescription>
              Revising the terms creates version {termsVersion + 1}, so both of you accept
              again before any collateral is placed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="trade-cash">Cash</Label>
                <MoneyInput
                  id="trade-cash"
                  value={cash}
                  onChange={(event) => setCash(event.target.value)}
                />
              </div>
              <div className="space-y-2">
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

            <div className="space-y-2">
              <Label htmlFor="trade-method">Handover</Label>
              <Select value={method} onValueChange={(value) => setMethod(value as typeof method)}>
                <SelectTrigger id="trade-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DELIVERY">Post the items</SelectItem>
                  <SelectItem value="IN_PERSON">Meet face to face</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {method === 'IN_PERSON' ? (
              <>
                <PlacePicker
                  id="trade-place"
                  label="Meeting location"
                  precision="exact"
                  value={place}
                  onChange={setPlace}
                  required
                  hint="Use a public spot both of you can find. Choose a suggestion to confirm the pin."
                  textFallbackPlaceholder="A public, agreed meeting point"
                />
                <div className="space-y-2">
                  <Label htmlFor="trade-meeting-at">Meeting time</Label>
                  <Input
                    id="trade-meeting-at"
                    type="datetime-local"
                    value={meetingAt}
                    onChange={(event) => setMeetingAt(event.target.value)}
                    required
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="trade-postage">Postage cost</Label>
                  <MoneyInput
                    id="trade-postage"
                    value={deliveryCost}
                    onChange={(event) => setDeliveryCost(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="trade-delivery">Postage details</Label>
                  <Textarea
                    id="trade-delivery"
                    value={deliveryDetails}
                    onChange={(event) => setDeliveryDetails(event.target.value)}
                    placeholder="Carrier, insurance, signature on delivery"
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="trade-note">Note</Label>
              <Textarea
                id="trade-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Explain what you changed"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
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
              Send counter
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
