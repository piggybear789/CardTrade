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
  CheckCircle2,
  CreditCard,
  ShieldAlert,
  Timer,
} from 'lucide-react';

import { cn } from '@/lib/utils';

interface FlowStepProps {
  icon: typeof CreditCard;
  title: string;
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
}

function FlowStepCopy({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="font-medium">{title}</p>
      <div className="mt-0.5 text-body text-muted-foreground">{children}</div>
    </div>
  );
}

function FlowStep({ icon: Icon, title, children, tone = 'neutral' }: FlowStepProps) {
  return (
    <div className="flex items-center gap-snug">
      <Icon
        className={cn(
          'size-4 shrink-0',
          tone === 'success' && 'text-emerald-700 dark:text-emerald-400',
          tone === 'warning' && 'text-gold',
          tone === 'neutral' && 'text-muted-foreground',
        )}
        aria-hidden
      />
      <FlowStepCopy title={title}>{children}</FlowStepCopy>
    </div>
  );
}

/** Explains the collateral lifecycle and resolution outcomes in a Trade contract. */
export function DittoBondExplainer() {
  return (
    <section className="space-y-cozy" aria-labelledby="dittobond-title">
      <div>
        <h3 id="dittobond-title" className="text-body font-semibold">
          How trade collateral works
        </h3>
        <p className="mt-1 text-body text-muted-foreground">
          Trade collateral is a temporary card authorisation that backs a trade. It is not
          a charge, and NoDitto does not receive the authorised amount while the trade
          is proceeding normally.
        </p>
      </div>

      <div className="grid gap-snug lg:hidden">
        <FlowStep icon={CreditCard} title="1. Authorise">
          When both traders accept, Stripe reserves the agreed value on each saved
          card. Your available card balance may reduce temporarily.
        </FlowStep>
        <FlowStep icon={ShieldAlert} title="2. Trade with protection">
          Each hold stays active while you send, receive, and inspect. No money moves
          merely because the hold is active.
        </FlowStep>
        <FlowStep icon={CheckCircle2} title="3. Release or resolve" tone="success">
          When both members accept, Stripe voids both holds. Your card issuer decides
          how quickly the available balance refreshes.
        </FlowStep>
      </div>

      <div className="hidden lg:block">
        <div className="relative grid grid-cols-3 items-center" aria-hidden>
          <span className="absolute inset-x-8 top-1/2 h-px -translate-y-1/2 bg-border" />
          <div className="relative z-[1] flex justify-center bg-card">
            <CreditCard className="size-4 text-muted-foreground" />
          </div>
          <div className="relative z-[1] flex justify-center bg-card">
            <ShieldAlert className="size-4 text-muted-foreground" />
          </div>
          <div className="relative z-[1] flex justify-center bg-card">
            <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-400" />
          </div>
        </div>
        <div className="mt-cozy grid grid-cols-3 gap-group text-center">
          <FlowStepCopy title="1. Authorise">
            When both traders accept, Stripe reserves the agreed value on each saved
            card. Your available card balance may reduce temporarily.
          </FlowStepCopy>
          <FlowStepCopy title="2. Trade with protection">
            Each hold stays active while you send, receive, and inspect. No money moves
            merely because the hold is active.
          </FlowStepCopy>
          <FlowStepCopy title="3. Release or resolve">
            When both members accept, Stripe voids both holds. Your card issuer decides
            how quickly the available balance refreshes.
          </FlowStepCopy>
        </div>
      </div>

      <div className="grid gap-snug border-t pt-cozy text-body sm:grid-cols-2">
        <div className="space-y-1">
          <p className="font-medium text-foreground">If something goes wrong</p>
          <p className="text-muted-foreground">
            A failed handover captures nothing. A condition dispute can capture a
            fixed $20 resolution fee; confirmed fraud can capture the responsible
            trader&apos;s full collateral and pay the affected trader.
          </p>
        </div>
        <div className="flex items-center gap-snug">
          <Timer className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Time matters.</span>{' '}
            Card authorisations normally expire after about seven days. The trade must
            resolve before a hold expires, or it no longer protects either side.
          </p>
        </div>
      </div>
    </section>
  );
}

function ProtectionOutcome({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof CreditCard;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-cozy py-cozy first:pt-0 last:pb-0">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-body font-semibold">{title}</p>
        <p className="mt-0.5 text-body leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
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
 * Three mutually exclusive outcomes answer the practical questions directly:
 * where payment is now, when it releases, and what a dispute changes.
 */
export function CashSaleProtectionExplainer({
  viewerIsBuyer,
  inPerson,
}: {
  viewerIsBuyer: boolean;
  inPerson: boolean;
}) {
  return (
    <section className="space-y-group" aria-labelledby="cash-sale-protection-title">
      <div>
        <h3 id="cash-sale-protection-title" className="text-lead font-semibold">
          How buyer protection works
        </h3>
        <p className="mt-1 text-body leading-relaxed text-muted-foreground">
          {viewerIsBuyer ? 'Your payment' : "The buyer's payment"} stays with NoDitto
          {inPerson ? ' until the buyer confirms the handover' : ' through delivery and inspection'}.
          The seller can see that it is paid, but cannot receive it yet.
        </p>
      </div>

      <div className="divide-y border-y py-cozy">
        <ProtectionOutcome icon={CreditCard} title="While the sale is active">
          The full payment remains held. {inPerson ? 'Meeting the seller' : 'Shipping the item'} does not
          release it.
        </ProtectionOutcome>
        <ProtectionOutcome
          icon={CheckCircle2}
          title={inPerson ? 'When the buyer confirms handover' : 'When the item is accepted'}
        >
          NoDitto releases the payment to the seller.
        </ProtectionOutcome>
        <ProtectionOutcome icon={ShieldAlert} title="If the buyer reports a problem">
          A dispute freezes the payment while support reviews both sides. Opening a
          dispute does not guarantee a refund.
        </ProtectionOutcome>
      </div>

      {!inPerson ? (
        <p className="flex gap-snug text-body leading-relaxed text-muted-foreground">
          <Timer className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            If the buyer takes no action before the inspection deadline, the sale
            completes automatically and the seller is paid.
          </span>
        </p>
      ) : null}
    </section>
  );
}
