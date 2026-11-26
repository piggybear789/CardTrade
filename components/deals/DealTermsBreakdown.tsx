'use client';

// components/deals/DealTermsBreakdown.tsx
//
// The figures behind a private deal's terms: what a buyer pays and the seller
// receives, or what a trader's hold and fee come to. Shared by the composer and the
// edit dialog, so starting a deal and changing one cannot state them differently.

import type { ReactNode } from 'react';

import { InfoPopover } from '@/components/ui/info-popover';
import { platformFeeCentsFor } from '@/domain/orchestrator/cashSaleOrchestrator';
import {
  PROCESSING_FEE_NAME,
  TRADE_FEE_NOTE,
  processingFeeShortNote,
  processingFeeRateLabel,
  tradeFeeRateLabel,
} from '@/lib/fees/feeLabels';
import { formatMoney } from '@/lib/format';

/**
 * THE ARITHMETIC IS THE CONTENT. Three figures rather than a rule to apply, and the
 * seller's real question, what they receive, carries the weight. Before a price is
 * entered there is nothing to add up, so it says how the fee works instead.
 */
export function SaleTermsBreakdown({
  priceCents,
  currency,
  payerLabel = 'They pay',
  holdHeight = false,
}: {
  priceCents: number | null;
  currency: string;
  /** Who pays, as the first row names them: the deal's other person, or "Buyers". */
  payerLabel?: string;
  /**
   * Draw the rows with "—" before a price is typed, instead of the one-line note, so
   * the box is the same height empty and filled. For a form where fields follow the
   * breakdown (the listing form), which would otherwise move down on the first digit.
   */
  holdHeight?: boolean;
}) {
  if (!priceCents && !holdHeight) {
    return (
      <p className="text-meta text-muted-foreground">
        {`The buyer pays a buyer protection fee on top (${processingFeeRateLabel(currency)} by card), so you receive your full price.`}
      </p>
    );
  }
  const fee = priceCents ? platformFeeCentsFor(priceCents, currency) : null;
  const figure = (cents: number | null) => (cents == null ? '—' : formatMoney(cents, currency));
  return (
    <Breakdown>
      <BreakdownRow
        label={payerLabel}
        value={figure(priceCents && fee != null ? priceCents + fee : null)}
      />
      <BreakdownRow
        label={PROCESSING_FEE_NAME}
        value={figure(fee)}
        info={processingFeeShortNote(currency)}
      />
      <BreakdownRule />
      <BreakdownRow
        label="You receive"
        value={figure(priceCents || null)}
        strong
        info="Paid to you through Stripe after the buyer accepts the card."
      />
    </Breakdown>
  );
}

/**
 * THE HOLD IS YOUR OWN SIDE'S VALUE. `bondPolicy` authorises 100% of a trader's own
 * side, so this sizes YOUR hold, not theirs. The fee is the Trade_Fee
 * (`tradeFee.ts`), a rate of what this trader RECEIVES, which the composer does not know yet.
 */
export function TradeTermsBreakdown({
  valueCents,
  currency,
}: {
  valueCents: number | null;
  currency: string;
}) {
  // NO "Transaction details / Held collateral" HEADER ROW. It repeated the row under
  // it in other words and cost the composer's deal screen its fit beside the preview.
  // The collateral row names itself, in the member copy for it.
  return (
    <Breakdown>
      <BreakdownRow
        label="Trade collateral, held on your card"
        value={valueCents ? formatMoney(valueCents, currency) : "Your card's value"}
        info="A temporary hold, not a charge. It's released when the trade completes."
      />
      <BreakdownRow label="Your fee" value={`${tradeFeeRateLabel()} of what you receive`} info={TRADE_FEE_NOTE} />
    </Breakdown>
  );
}

function Breakdown({ children }: { children: ReactNode }) {
  return <div className="grid gap-cozy rounded-lg bg-muted/60 p-cozy">{children}</div>;
}

function BreakdownRule() {
  return <div className="h-px bg-border" aria-hidden />;
}

function BreakdownRow({
  label,
  value,
  info,
  strong = false,
}: {
  label: string;
  value: string;
  /** The explanation behind the figure, behind an (i) so the row stays one line. */
  info?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-cozy">
      <span className="flex min-w-0 items-center gap-tight">
        <span className={strong ? 'text-body font-medium text-foreground' : 'text-body text-muted-foreground'}>
          {label}
        </span>
        {info ? <InfoPopover label={`About ${label.toLowerCase()}`}>{info}</InfoPopover> : null}
      </span>
      <span
        className={
          strong
            ? 'text-right text-lead font-semibold tabular-nums text-foreground'
            : 'text-right text-body font-medium tabular-nums text-foreground'
        }
      >
        {value}
      </span>
    </div>
  );
}
