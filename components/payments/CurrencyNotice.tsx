// components/payments/CurrencyNotice.tsx
//
// The ONE place a buyer is told what currency they pay in and what converting it costs.
//
// Two separate facts, and the copy keeps them apart:
//
//   1. The Currency_Conversion fee. Charged by NoDitto when the contract's currency is
//      not the one its Stripe platform settles in (a EUR or GBP sale on the US
//      platform). The buyer absorbs it so the seller is paid exactly the agreed price.
//      Its figure comes from `currencyConversionFeeFor`, the function the orchestrator
//      charges with, so the disclosure cannot drift from the charge.
//   2. The buyer's own bank. If their card is not in the contract's currency, their
//      bank converts and may add a foreign-transaction fee. We do not know the card's
//      currency, so this is said whenever the buyer's region uses a different currency
//      from the contract, and never quoted as a figure.
//
// Server-safe (no hooks), so it renders inside Server and Client Components alike.

import { HugeiconsIcon } from '@hugeicons/react';
import { Exchange01Icon } from '@hugeicons/core-free-icons';

import { FX_FEE_BPS, currencyConversionFeeFor } from '@/domain/fees/fxFee';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

/** "2%", from the rate the fee is charged at. */
export function fxFeeRateLabel(): string {
  const percent = FX_FEE_BPS / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

export interface CurrencyNoticeProps {
  /** The contract's currency: what the buyer is charged in. */
  currency: string;
  /** The contract total before conversion (price + fee + shipping), minor units. */
  amountMinor: number;
  /** The buyer's own region currency, when known, to decide the bank note. */
  buyerCurrency?: string | null;
  /** Who is paid the agreed figure, and what it is called. Defaults to a cash sale. */
  recipient?: { who: string; what: string };
  className?: string;
}

/**
 * What the buyer pays in, and any conversion cost. Renders nothing when there is
 * nothing to disclose: same currency as the buyer's region and no conversion fee.
 */
export function CurrencyNotice({
  currency,
  amountMinor,
  buyerCurrency,
  recipient = { who: 'the seller', what: 'the agreed price' },
  className,
}: CurrencyNoticeProps) {
  const code = currency.trim().toUpperCase();
  const fxFee = currencyConversionFeeFor(amountMinor, currency);
  const buyerCode = buyerCurrency?.trim().toUpperCase() || null;
  const foreignToBuyer = Boolean(buyerCode && buyerCode !== code);

  if (fxFee === 0 && !foreignToBuyer) return null;

  return (
    <div
      className={cn(
        'flex items-start gap-snug rounded-md border border-iris/30 bg-iris/5 p-cozy text-meta',
        className,
      )}
      role="note"
      aria-label="Currency"
    >
      <HugeiconsIcon icon={Exchange01Icon} className="mt-px size-4 shrink-0 text-iris-ink" aria-hidden />
      <div className="min-w-0 space-y-tight">
        <p className="font-medium text-foreground">You pay in {code}.</p>
        {fxFee > 0 ? (
          <p className="text-muted-foreground">
            Includes a {formatMoney(fxFee, currency)} currency conversion fee ({fxFeeRateLabel()}). It
            covers converting your payment so {recipient.who} receives exactly {recipient.what}, and it is
            not refunded.
          </p>
        ) : null}
        {foreignToBuyer ? (
          <p className="text-muted-foreground">
            If your card is not in {code}, your bank converts it and may add its own
            foreign-transaction fee.
          </p>
        ) : null}
      </div>
    </div>
  );
}
