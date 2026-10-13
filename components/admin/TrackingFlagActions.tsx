'use client';

// components/admin/TrackingFlagActions.tsx
//
// Staff decision on a flagged outbound tracking number (ESC-02).
//
// A flag means the carrier data cannot be trusted as this sale's delivery: it was
// delivered before the sale shipped, or it was already delivered when the seller
// entered it. That is the stale-number attack, so no inspection clock starts until
// staff decide:
//
//   * Start the inspection — the delivery is genuine; the buyer's window starts now.
//   * Refund the buyer     — it is not this parcel; full refund, nothing to return.

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { resolveTrackingFlag } from '@/lib/actions/admin';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PendingLabel } from '@/components/ui/pending-label';
import { formatContractDateTime } from '@/lib/format';
import type { TrackingFlagDecision } from '@/domain/orchestrator/cashSaleOrchestrator';

export interface TrackingFlagActionsProps {
  cashSaleId: string;
  reason: 'DELIVERED_BEFORE_SHIPMENT' | 'DELIVERED_AT_REGISTRATION' | null;
  carrierDeliveredAt: string | null;
}

export function TrackingFlagActions({ cashSaleId, reason, carrierDeliveredAt }: TrackingFlagActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<TrackingFlagDecision | null>(null);

  function decide(decision: TrackingFlagDecision) {
    startTransition(async () => {
      const result = await resolveTrackingFlag(cashSaleId, decision);
      setConfirming(null);
      if (result.ok) {
        toast.success(decision === 'START_CLOCK' ? 'The buyer\'s inspection has started.' : 'The buyer is being refunded.');
        return;
      }
      toast.error(result.message ?? 'The tracking flag could not be resolved.');
    });
  }

  return (
    <div className="space-y-snug rounded-lg border border-border bg-muted p-cozy text-body">
      <p className="font-medium">Tracking flagged</p>
      <p className="text-muted-foreground">
        {reason === 'DELIVERED_AT_REGISTRATION'
          ? 'The number was already delivered when the seller entered it.'
          : 'The carrier reports delivery before this sale was shipped.'}
        {carrierDeliveredAt
          ? ` Carrier delivery time: ${formatContractDateTime(carrierDeliveredAt) ?? carrierDeliveredAt}.`
          : ''}{' '}
        Check the tracking history against the buyer&apos;s address before deciding.
      </p>
      <div className="flex flex-wrap gap-snug">
        <Button type="button" size="sm" disabled={isPending} onClick={() => setConfirming('START_CLOCK')}>
          <PendingLabel pending={isPending}>Start the inspection</PendingLabel>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={isPending}
          onClick={() => setConfirming('REFUND_BUYER')}
        >
          Refund the buyer
        </Button>
      </div>
      {confirming ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          title={confirming === 'START_CLOCK' ? 'Start the buyer\'s inspection?' : 'Refund the buyer in full?'}
          description={
            confirming === 'START_CLOCK'
              ? 'You are confirming the parcel genuinely reached the buyer. Their 7-day inspection starts now, after which the seller is paid unless they raise a problem.'
              : 'You are deciding this is not the sale\'s parcel. The buyer is refunded in full with nothing to return, and the item goes back on sale. This cannot be undone.'
          }
          confirmLabel={confirming === 'START_CLOCK' ? 'Start inspection' : 'Refund buyer'}
          confirmVariant={confirming === 'REFUND_BUYER' ? 'destructive' : undefined}
          pending={isPending}
          onConfirm={() => decide(confirming)}
        />
      ) : null}
    </div>
  );
}
