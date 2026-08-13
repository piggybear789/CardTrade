'use client';

// components/sales/CashSaleReturnPanel.tsx
//
// The member-facing surface of a return-conditional refund (0088).
//
// ONE PANEL, FOUR AUDIENCES, because the two parties need different things at the same
// two statuses and splitting it per role would put the shared facts — the deadline, the
// address, the tracking — in four places:
//
//   RETURN_PENDING     seller  -> give the buyer somewhere to post it
//                      buyer   -> post it, once an address exists
//   RETURN_IN_TRANSIT  buyer   -> what happens next, and that they need do nothing
//                      seller  -> the parcel is coming, and how to contest it
//
// WHAT THE COPY MUST NOT DO. A refund waiting on a parcel is the most misreadable
// state in the product: the buyer has won and has not been paid, and the seller has
// lost and has not lost the item. Every line here says WHO acts next and WHAT releases
// the money, and none of it threatens a refund that is not actually at risk — a lapsed
// return goes to a human, not to the seller (0089).

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { PackageCheck, RotateCcw } from 'lucide-react';

import {
  disputeCashSaleReturn,
  recordCashSaleReturnShipment,
  saveCashSaleReturnAddress,
} from '@/lib/actions/cashSale';
import { InspectionCountdown, RecordShipmentDialog } from '@/components/fulfilment';
import { PlacePicker, type PlaceValue } from '@/components/location';
import { HandoverFailedDialog } from '@/components/fulfilment/HandoverFailedDialog';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';

export interface CashSaleReturnPanelProps {
  cashSaleId: string;
  status: 'RETURN_PENDING' | 'RETURN_IN_TRANSIT';
  viewerIsBuyer: boolean;
  amountCents: number;
  currency: string;
  /** The seller's return address, once they have given one. */
  returnAddressLabel: string | null;
  returnDeadlineAt: string | null;
  returnTrackingCarrier: string | null;
  returnTrackingNumber: string | null;
  returnDisputedAt: string | null;
  returnDisputeReason: string | null;
  returnLapsedAt: string | null;
  counterpartyName: string;
}

export function CashSaleReturnPanel({
  cashSaleId,
  status,
  viewerIsBuyer,
  amountCents,
  currency,
  returnAddressLabel,
  returnDeadlineAt,
  returnTrackingCarrier,
  returnTrackingNumber,
  returnDisputedAt,
  returnDisputeReason,
  returnLapsedAt,
  counterpartyName,
}: CashSaleReturnPanelProps) {
  const [pending, startTransition] = useTransition();
  const [shipOpen, setShipOpen] = useState(false);
  const [address, setAddress] = useState<PlaceValue | null>(null);

  const amount = formatMoney(amountCents, currency);
  const inTransit = status === 'RETURN_IN_TRANSIT';

  function onSaveAddress() {
    if (!address) return;
    startTransition(async () => {
      const result = await saveCashSaleReturnAddress(cashSaleId, {
        label: address.label,
        placeId: address.placeId ?? null,
        countryCode: address.countryCode ?? null,
        lat: address.lat ?? null,
        lng: address.lng ?? null,
      });
      if (result.ok) toast.success('Return address saved');
      else toast.error('Could not save that address');
    });
  }

  function onRecordShipment(shipment: { carrier: string; trackingNumber: string }) {
    startTransition(async () => {
      const result = await recordCashSaleReturnShipment(
        cashSaleId,
        shipment.carrier,
        shipment.trackingNumber,
      );
      if (result.ok) {
        setShipOpen(false);
        toast.success('Return tracking added');
      } else {
        toast.error('Could not record that return');
      }
    });
  }

  // Returns the dialog's own result shape rather than toasting here, so the dialog can
  // keep itself open on failure and preserve what the seller typed.
  async function onContest(reason: string) {
    const result = await disputeCashSaleReturn(cashSaleId, reason);
    if (result.ok) return { ok: true as const };
    return { ok: false as const, message: 'Could not report that problem. Try again.' };
  }

  // A contested return has left the automatic path entirely. Say so first and stop —
  // showing "post it back" or a countdown underneath would contradict it.
  if (returnDisputedAt) {
    return (
      <section className="space-y-2 border-t pt-6">
        <h3 className="flex items-center gap-2 font-semibold">
          <RotateCcw className="size-4 text-destructive" aria-hidden="true" />
          Return under review
        </h3>
        <p className="text-sm text-muted-foreground">
          {viewerIsBuyer
            ? `${counterpartyName} reported a problem with the return, so your ${amount} refund is on hold while our team reviews it. Nothing has been paid out either way.`
            : `You reported a problem with this return. Our team is reviewing it and no money moves until they decide.`}
        </p>
        {returnDisputeReason ? (
          <p className="text-sm">
            <span className="text-muted-foreground">Reported: </span>
            {returnDisputeReason}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="space-y-4 border-t pt-6">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 font-semibold">
          <RotateCcw className="size-4 text-gold" aria-hidden="true" />
          {inTransit ? 'Return on its way' : 'Return needed before the refund'}
        </h3>
        <p className="text-sm text-muted-foreground">
          {/* States the CONDITION on the money in one sentence, for both parties. */}
          {inTransit
            ? viewerIsBuyer
              ? `Your ${amount} refund is released automatically as soon as the carrier confirms it reached ${counterpartyName}. There is nothing else for you to do.`
              : `${counterpartyName} has posted the item back. Their ${amount} refund is released automatically when the carrier confirms it reached you, and your listing goes back on sale at the same time.`
            : viewerIsBuyer
              ? `Your ${amount} refund was approved and is waiting on the item going back to ${counterpartyName}. Post it, add the tracking number, and the refund releases when the carrier confirms it arrived.`
              : `${counterpartyName} is refunded once they post the item back to you. Give them a return address so they can.`}
        </p>
      </div>

      {/* R6: the buyer pays return postage, and they learn that BEFORE they are
          standing at a post office, not after. Unreimbursed is a policy decision
          (D2) and stating it plainly is the only honest way to charge it. */}
      {viewerIsBuyer && !inTransit ? (
        <p className="text-sm text-muted-foreground">
          Return postage is at your cost and is not refunded. Use a tracked service —
          the refund depends on the carrier confirming delivery, so an untracked parcel
          cannot release it.
        </p>
      ) : null}

      {returnDeadlineAt && !inTransit ? (
        <InspectionCountdown
          deadlineAt={returnDeadlineAt}
          viewerMustAct={viewerIsBuyer}
          // NOT "you lose your refund", because that is not what happens. Saying so
          // would be a lie told to force action.
          expiryConsequence={
            viewerIsBuyer
              ? 'If you miss it, our team reviews the case instead of closing it automatically — your refund is not cancelled, but it takes longer.'
              : 'If they miss it, our team reviews the case. Nothing is paid out to either side on a timer.'
          }
        />
      ) : null}

      {/* Seller: capture the return address. Shown until one exists, then read-only —
          removing it mid-return would strip the buyer of where to post. */}
      {!viewerIsBuyer && !returnAddressLabel ? (
        <div className="space-y-3">
          <PlacePicker
            precision="exact"
            value={address}
            onChange={setAddress}
            label="Return address"
            hint="Where the buyer should post the item back to. Shared with them only."
            disabled={pending}
            required
          />
          <Button onClick={onSaveAddress} disabled={!address || pending} className="w-full">
            {pending ? 'Saving…' : 'Save return address'}
          </Button>
        </div>
      ) : null}

      {returnAddressLabel ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Return address: </span>
          {returnAddressLabel}
        </p>
      ) : null}

      {returnTrackingNumber ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Return tracking: </span>
          {returnTrackingCarrier ? `${returnTrackingCarrier} · ` : ''}
          {returnTrackingNumber}
        </p>
      ) : null}

      {returnLapsedAt ? (
        <p className="text-sm text-muted-foreground">
          The return deadline passed, so our team is reviewing this case. It closes on
          its own if the item is posted and arrives.
        </p>
      ) : null}

      {/* Buyer: record the return. Gated on an address existing, because posting to
          nowhere is not a thing we should let someone confirm. */}
      {viewerIsBuyer && !inTransit ? (
        <Button
          onClick={() => setShipOpen(true)}
          disabled={pending || !returnAddressLabel}
          className="w-full"
        >
          <PackageCheck className="mr-2 size-4" aria-hidden="true" />
          {returnAddressLabel ? 'Add return tracking' : 'Waiting on a return address'}
        </Button>
      ) : null}

      {/* Seller: contest the return. Only once it is actually in transit — there is
          nothing to contest before the buyer has posted anything. Evidence matters
          more here than almost anywhere: "the box arrived empty" is exactly the claim
          a photograph settles, and this dialog already collects them. */}
      {!viewerIsBuyer && inTransit ? (
        <HandoverFailedDialog
          onSubmit={onContest}
          triggerLabel="Report a problem with the return"
          triggerVariant="outline"
          title="Report a problem with the return"
          outcomeDescription={
            'This pauses the refund and sends the case to our team. It does not decide it, '
            + 'and nothing is paid out to either side while they look. Add photos of what '
            + 'arrived if you can — an empty or wrong parcel is much easier to act on with them.'
          }
          reasonPlaceholder="What arrived, or what did not?"
          successMessage="Our team will review this return"
          evidenceContext={{ caseKind: 'CASH_SALE', caseRef: cashSaleId }}
        />
      ) : null}

      <RecordShipmentDialog
        open={shipOpen}
        onOpenChange={setShipOpen}
        onSubmit={onRecordShipment}
        pending={pending}
        recipientName={counterpartyName}
        recipientAddressKnown={Boolean(returnAddressLabel)}
        title="Add return tracking"
        description={`Add the carrier and tracking number for the item you are posting back to ${counterpartyName}. Your refund releases when the carrier confirms it arrived.`}
        submitLabel="Add tracking"
      />
    </section>
  );
}
