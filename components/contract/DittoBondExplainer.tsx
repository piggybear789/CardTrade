// components/contract/DittoBondExplainer.tsx
//
// Member-facing explanation of a trade's collateral. A trade collateral hold is a Stripe
// card authorisation backing both sides of a trade — not a payment and not money held
// by the platform. It deliberately lives beside the live hold list so a member can
// understand both the current status and the consequences before accepting terms.

import type { ReactNode } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  ShieldAlert,
  Timer,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatAud } from '@/lib/format';

interface FlowStepProps {
  icon: typeof CreditCard;
  title: string;
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
}

function FlowStep({ icon: Icon, title, children, tone = 'neutral' }: FlowStepProps) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        tone === 'success' && 'border-emerald-500/30 bg-emerald-500/5',
        tone === 'warning' && 'border-amber-500/30 bg-amber-500/5',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border bg-background',
            tone === 'success' && 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
            tone === 'warning' && 'border-amber-500/40 text-amber-700 dark:text-amber-400',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Explains the collateral lifecycle and resolution outcomes in a Trade contract. */
export function DittoBondExplainer() {
  return (
    <section
      className="space-y-3 rounded-xl border bg-muted/20 p-3.5"
      aria-labelledby="dittobond-title"
    >
      <div>
        <h3 id="dittobond-title" className="text-sm font-semibold">
          How trade collateral works
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Trade collateral is a temporary card authorisation that backs a trade. It is not
          a charge, and NoDitto does not receive the authorised amount while the trade
          is proceeding normally.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-stretch">
        <FlowStep icon={CreditCard} title="1. Authorise">
          When both traders accept, Stripe reserves the agreed value on each saved
          card. Your available card balance may reduce temporarily.
        </FlowStep>
        <ArrowRight className="mx-auto hidden size-4 self-center text-muted-foreground sm:block" aria-hidden />
        <FlowStep icon={ShieldAlert} title="2. Trade with protection">
          Each hold stays active while you send, receive, and inspect. No money moves
          merely because the hold is active.
        </FlowStep>
        <ArrowRight className="mx-auto hidden size-4 self-center text-muted-foreground sm:block" aria-hidden />
        <FlowStep icon={CheckCircle2} title="3. Release or resolve" tone="success">
          When both members accept, Stripe voids both holds. Your card issuer decides
          how quickly the available balance refreshes.
        </FlowStep>
      </div>

      <div className="grid gap-2 border-t pt-3 text-xs sm:grid-cols-2">
        <div className="space-y-1">
          <p className="font-medium text-foreground">If something goes wrong</p>
          <p className="leading-relaxed text-muted-foreground">
            A failed handover captures nothing. A condition finding can capture a
            fixed $20 Friction_Tax; objective fraud can capture the responsible
            trader&apos;s full collateral and pay the affected trader.
          </p>
        </div>
        <div className="flex gap-2 rounded-md bg-background/70 p-2.5">
          <Timer className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Time matters.</span>{' '}
            Card authorisations normally expire after about seven days. The trade must
            resolve before a hold expires, or it no longer protects either side.
          </p>
        </div>
      </div>
    </section>
  );
}


export interface CashSaleCollateralExplainerProps {
  sellerBondCents: number;
  sellerName: string;
}

/**
 * Explains why a Cash_Sale normally uses collected payment rather than a matching
 * trade collateral hold.
 * Buyer funds are genuinely collected, then retained by the platform until the
 * sale resolves; that is distinct from an uncaptured Trade authorisation.
 */
export function CashSaleCollateralExplainer({
  sellerBondCents,
  sellerName,
}: CashSaleCollateralExplainerProps) {
  const sellerBondRequired = sellerBondCents > 0;

  return (
    <section
      className="space-y-3 rounded-xl border bg-muted/20 p-3.5"
      aria-labelledby="cash-sale-protection-title"
    >
      <div>
        <h3 id="cash-sale-protection-title" className="text-sm font-semibold">
          How protection works on this cash sale
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          A cash sale uses collected payment rather than two matching trade collateral holds. The
          buyer&apos;s payment is real money; it is not a temporary card hold.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-stretch">
        <FlowStep icon={CreditCard} title="1. Buyer pays">
          Stripe collects the agreed item price and delivery cost. The buyer does not
          post a separate collateral hold because their payment already commits the sale.
        </FlowStep>
        <ArrowRight className="mx-auto hidden size-4 self-center text-muted-foreground sm:block" aria-hidden />
        <FlowStep icon={ShieldAlert} title="2. Goods are delivered">
          The proceeds stay with the platform while the seller fulfils the order and
          the buyer has their inspection window. The seller has not been paid yet.
        </FlowStep>
        <ArrowRight className="mx-auto hidden size-4 self-center text-muted-foreground sm:block" aria-hidden />
        <FlowStep icon={CheckCircle2} title="3. Sale resolves" tone="success">
          Once the buyer accepts—or the inspection period ends without a dispute—the
          seller receives their net amount. A refund goes back to the buyer&apos;s original card.
        </FlowStep>
      </div>

      <div className="rounded-md border bg-background/70 p-2.5 text-xs leading-relaxed text-muted-foreground">
        {sellerBondRequired ? (
          <>
            <span className="font-medium text-foreground">Extra seller protection:</span>{' '}
            {sellerName} must also authorise {formatAud(sellerBondCents)} as a
            temporary collateral hold on their saved card. It is released when the contract resolves; it is only
            captured if the applicable resolution calls for it.
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">Why no separate collateral appears here:</span>{' '}
            the seller has passed the Identity_Gate for Stripe payouts, while the
            buyer&apos;s payment is already collected. This is the normal Cash_Sale setup,
            not an absence of buyer protection.
          </>
        )}
      </div>
    </section>
  );
}
