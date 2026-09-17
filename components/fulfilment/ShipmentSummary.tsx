// components/fulfilment/ShipmentSummary.tsx
//
// WHERE IS THE PARCEL. One posted shipment, stated so either party can act on it: who
// is carrying it, the number, a way to open the carrier's own tracking page, and — when
// the provider can poll — a way to ask again.
//
// It replaces a bare `carrier · number` string. That string was true and useless: the
// number is only worth having if you can get to the carrier's page with it, and the
// contract already stores the URL (`carrierTrackingUrl`, from the shared carrier
// registry). Both parties were reading the number and pasting it into a search engine.
//
// THE DATES ARE NOT INTERCHANGEABLE, and the copy keeps them apart. `shippedAt` is the
// seller's own assertion that they posted it. `carrierDeliveredAt` is the carrier's, and
// it is the ONLY one that starts the inspection clock — see the note on
// `ShipmentSnapshot`. Presenting them as one "status" line would blur exactly the
// distinction the escrow depends on.
//
// No server action of its own, like everything else in this folder: a refresh is the
// room's action, injected.

'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowUpRightIcon,
  LoaderCircleIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import { formatContractDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { FulfilmentTrackingState, ShipmentSnapshot } from '@/domain/fulfilment';

/**
 * What each carrier state says to a member.
 *
 * A DISPLAY MAP, so it lives here rather than in `domain/`: the states are the domain's,
 * the words are the interface's. `UNKNOWN` is deliberately not "Unknown" — the member
 * has not lost anything, we simply have no update, and saying so is less alarming and
 * more accurate.
 */
const STATE_LABEL: Record<FulfilmentTrackingState, string> = {
  LABEL_CREATED: 'Label created',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  EXCEPTION: 'Delivery problem reported',
  UNKNOWN: 'No update yet',
};

export interface ShipmentSummaryProps {
  shipment: ShipmentSnapshot;
  /** When the sender said they posted it. Their word, not the carrier's. */
  shippedAt?: string | null;
  /**
   * Ask the carrier again. Omit when the configured provider cannot poll — the manual
   * binding deliberately cannot, and a refresh button that never changes anything is
   * worse than none.
   */
  onRefresh?: () => void;
  refreshing?: boolean;
  className?: string;
}

export function ShipmentSummary({
  shipment,
  shippedAt,
  onRefresh,
  refreshing = false,
  className,
}: ShipmentSummaryProps) {
  const { carrier, trackingNumber, trackingUrl, status, carrierDeliveredAt } = shipment;
  if (!trackingNumber) return null;

  const posted = formatContractDateTime(shippedAt);
  const delivered = formatContractDateTime(carrierDeliveredAt);

  return (
    <div className={cn('flex flex-col gap-snug', className)}>
      <div className="flex flex-wrap items-center gap-x-cozy gap-y-snug">
        <p className="min-w-0 text-body">
          {carrier ? <span className="font-medium text-foreground">{carrier}</span> : null}
          {carrier ? <span className="text-muted-foreground"> · </span> : null}
          {/* `display-value` for the number itself: it is a reference someone reads
              aloud, compares against a receipt, or copies. Tabular figures are what
              make that possible. */}
          <span className="display-value break-all text-foreground">{trackingNumber}</span>
        </p>

        {trackingUrl ? (
          <Button asChild variant="outline" size="sm">
            {/* `noopener` and a stated new tab: this leaves the contract room for a
                third-party site, and a link that does that without saying so is the
                thing screen-reader users are entitled to be told about. */}
            <a
              href={trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Track this parcel with ${carrier ?? 'the carrier'} (opens in a new tab)`}
            >
              Track parcel
              <HugeiconsIcon icon={ArrowUpRightIcon} aria-hidden />
            </a>
          </Button>
        ) : null}

        {onRefresh ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            aria-busy={refreshing}
          >
            <HugeiconsIcon
              icon={refreshing ? LoaderCircleIcon : RefreshIcon}
              className={refreshing ? 'animate-spin' : undefined}
              aria-hidden
            />
            {refreshing ? 'Checking…' : 'Check for updates'}
          </Button>
        ) : null}
      </div>

      {/* ONE LINE, CARRIER FACT FIRST. A confirmed delivery outranks everything else
          here, because it is the fact the inspection window hangs off. */}
      <p className="text-meta text-muted-foreground">
        {delivered ? (
          <>
            Delivered {delivered}, confirmed by the carrier.
          </>
        ) : (
          <>
            {status ? STATE_LABEL[status] : 'No update yet'}
            {posted ? ` · posted ${posted}` : null}
            {!trackingUrl
              ? ' · this carrier has no tracking page, so arrival is confirmed by hand'
              : null}
          </>
        )}
      </p>
    </div>
  );
}
