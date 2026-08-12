// components/contract/DittoBondExplainer.tsx
//
// Member-facing explanations of where money sits in each transaction model. The two
// exports describe DIFFERENT mechanisms and must not be merged:
//
//   * `DittoBondExplainer` — a TRADE's collateral. A Stripe card authorisation
//     backing both sides; not a payment, and the platform never receives the
//     authorised amount while the trade proceeds normally. Lives beside the live
//     hold list so a member sees status and consequences before accepting terms.
//   * `CashSaleProtectionExplainer` — a CASH SALE's collected payment. Real money,
//     genuinely taken from the Buyer's card and held by the platform. There is no
//     collateral anywhere in this flow, and it says so by omission rather than by
//     explaining an absence.
//
// Member-facing copy says "trade collateral" and "a temporary card hold", never
// "escrow" for the trade case — the platform holds a claim there, not funds.

import type { ReactNode } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Package,
  Search,
  ShieldAlert,
  ShieldCheck,
  Timer,
} from 'lucide-react';

import { cn } from '@/lib/utils';

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
            A failed handover captures nothing. A condition dispute can capture a
            fixed $20 resolution fee; confirmed fraud can capture the responsible
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


/** One stage of the cash-sale money flow. */
function MoneyStage({
  index,
  title,
  where,
  icon,
  tone = 'neutral',
  last = false,
  children,
}: {
  index: number;
  title: string;
  /** Where the buyer's money physically is during this stage. */
  where: string;
  /** Lucide icon name for the stage marker. */
  icon?: 'credit-card' | 'package' | 'search' | 'check-circle';
  tone?: 'neutral' | 'success';
  /** Suppresses the connector beneath the final stage. */
  last?: boolean;
  children: ReactNode;
}) {
  const IconComponent = icon
    ? { 'credit-card': CreditCard, 'package': Package, 'search': Search, 'check-circle': CheckCircle2 }[icon]
    : null;

  return (
    <li className="flex gap-3 sm:gap-4">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-full border',
            tone === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
              : 'border-border bg-background text-foreground',
          )}
          aria-hidden
        >
          {IconComponent ? <IconComponent className="size-4" /> : index}
        </span>
        {last ? null : <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
      </div>

      <div className={cn('min-w-0 flex-1', last ? 'pb-0' : 'pb-5')}>
        <p className="text-sm font-semibold leading-tight">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{children}</p>
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-xs">
          <span className="font-medium uppercase tracking-wide text-muted-foreground">
            Money
          </span>
          <span
            className={cn(
              'font-medium',
              tone === 'success' ? 'text-emerald-700' : 'text-foreground',
            )}
          >
            {where}
          </span>
        </p>
      </div>
    </li>
  );
}

/**
 * Explains where a Cash_Sale buyer's money sits at each stage, and when the Seller
 * is paid.
 *
 * DELIBERATELY SAYS NOTHING ABOUT COLLATERAL. A Cash_Sale has none: the Buyer's
 * money is genuinely collected up front, so there is nothing left for either party
 * to guarantee with a card hold. `requiredBondCents` only ever returned a
 * non-zero Seller bond for an UNVERIFIED Seller, and publishing a listing requires
 * the Identity_Gate, so every Cash_Sale Seller is verified and that figure was
 * always zero. Explaining an absent mechanism — and justifying it by naming the
 * Identity_Gate — read as a caveat about missing protection when the collected
 * payment IS the protection.
 *
 * Trade collateral is a different thing entirely and is explained by
 * `DittoBondExplainer`; do not merge the two.
 *
 * The stages are a vertical list, not the three side-by-side columns this replaced.
 * In a `max-w-2xl` dialog those columns were ~150px wide, so every line broke after
 * two or three words.
 */
export function CashSaleProtectionExplainer() {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Your payment is held by NoDitto until you&apos;re happy — the seller
        is never paid directly.
      </p>

      <ol className="list-none">
        <MoneyStage index={1} title="You pay" where="Held by NoDitto" icon="credit-card">
          Stripe collects the item price + delivery. This commits the sale.
        </MoneyStage>

        <MoneyStage index={2} title="Seller ships" where="Held by NoDitto" icon="package">
          They can see it&apos;s paid — that&apos;s their signal to post.
        </MoneyStage>

        <MoneyStage index={3} title="You inspect" where="Held by NoDitto" icon="search">
          Check the item when it arrives. Dispute within the window if
          something&apos;s wrong.
        </MoneyStage>

        <MoneyStage
          index={4}
          title="Resolved"
          where="Released to seller, or refunded to you"
          icon="check-circle"
          tone="success"
          last
        >
          Accept or let the window close → seller is paid. Dispute → money
          stays frozen for review.
        </MoneyStage>
      </ol>

      <div className="flex items-start gap-2.5 rounded-md border bg-muted/30 p-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-trust" aria-hidden />
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Every seller is verified</span>{' '}
          — photo ID + selfie via Stripe before they can list anything.
        </p>
      </div>
    </div>
  );
}
