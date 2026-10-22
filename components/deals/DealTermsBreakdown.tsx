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
  TRADE_NO_FEE_NOTE,
  processingFeeExplanation,
  processingFeeRateLabel,
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
}: {
  priceCents: number | null;
  currency: string;
}) {
  if (!priceCents) {
    return (
      <p className="text-meta text-muted-foreground">
        {`The buyer pays a service fee on top (${processingFeeRateLabel(currency)} by card), so you receive your full price.`}
      </p>
    );
  }
  const fee = platformFeeCentsFor(priceCents, currency);
  return (
    <Breakdown>
      <BreakdownRow label="They pay" value={formatMoney(priceCents + fee, currency)} />
      <BreakdownRow
        label={PROCESSING_FEE_NAME}
        value={formatMoney(fee, currency)}
        info={processingFeeExplanation(currency)}
      />
      <BreakdownRule />
      <BreakdownRow
        label="You receive"
        value={formatMoney(priceCents, currency)}
        strong
        info="Paid to you through Stripe after they accept the card."
      />
    </Breakdown>
  );
}

/**
 * THE HOLD IS YOUR OWN SIDE'S VALUE. `bondPolicy` authorises 100% of a trader's own
 * side, so this sizes YOUR hold, not theirs. Trades carry no fee (`tradeFee.ts`), and
 * the row says so rather than disappearing, so the absence is stated.
 */
export function TradeTermsBreakdown({
  valueCents,
  currency,
}: {
  valueCents: number | null;
  currency: string;
}) {
  return (
    <Breakdown>
      <BreakdownRow label="Transaction details" value="Held collateral" strong />
      <BreakdownRule />
      <BreakdownRow
        label="Held on your payment card"
        value={valueCents ? formatMoney(valueCents, currency) : "Your card's value"}
        info="A hold, not a charge. It's released when the trade completes."
      />
      <BreakdownRow label="Your fee" value={formatMoney(0, currency)} info={TRADE_NO_FEE_NOTE} />
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
