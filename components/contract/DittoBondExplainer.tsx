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
import { Icon } from '@/components/ui/icon';
import {
  CheckCircleIcon,
  CreditCardIcon,
  ShieldWarningIcon,
  TimerIcon,
} from '@/components/ui/icons';

import { cn } from '@/lib/utils';

/**
 * What each ending does to the viewer's hold, as plain sentences (UX review
 * 2026-11-27).
 *
 * A condition dispute no longer says "Up to $20.00". Since ESC-01 nothing is
 * captured when a dispute is raised; staff choose any compensation at the decision,
 * up to what the hold can still pay (`resolveTradeDispute`, CONDITION). The flat
 * Friction_Tax figure survives only for legacy partial captures.
 */
function outcomes(other: string): { event: string; result: string; bad?: boolean }[] {
  return [
    { event: 'The trade completes', result: 'Released' },
    { event: 'The handover fails', result: 'Released' },
    { event: `${other} proves a condition problem`, result: 'Part, set by support' },
    { event: 'Support finds fraud by you', result: `All of it, to ${other}`, bad: true },
  ];
}

/**
 * The consequences of a trade's collateral, under the hold summary
 * (`HoldStatus`) in the Collateral tab.
 */
export function DittoBondExplainer({
  counterpartName = 'the other trader',
}: {
  /** The other trader's display name, for "Bob proves a condition problem". */
  counterpartName?: string;
  /** @deprecated No figure is shown any more; kept so call sites compile. */
  currency?: string;
}) {
  const other = counterpartName;
  return (
    <section className="text-body" aria-labelledby="dittobond-title">
      <h3 id="dittobond-title" className="text-meta font-semibold">
        What happens to your hold
      </h3>
      <ul className="mt-tight divide-y divide-border/60">
        {outcomes(other).map(({ event, result, bad }) => (
          <li key={event} className="flex items-baseline justify-between gap-cozy py-snug">
            <span className="min-w-0">{event}</span>
            <span className={cn('shrink-0 text-right', bad ? 'text-destructive' : 'text-muted-foreground')}>
              {result}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-snug flex items-start gap-snug text-meta text-muted-foreground">
        <Icon icon={TimerIcon} className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {/* ESC-17a: a card hold placed without the cardholder can lapse in under
            five days, and the trade clock is planned inside that. */}
        Card holds only last a few days, so the meeting and inspection are planned
        to finish well before they expire.
      </p>
    </section>
  );
}

function ProtectionOutcome({
  icon: Glyph,
  title,
  children,
  action,
}: {
  icon: typeof CreditCardIcon;
  title: string;
  children: ReactNode;
  /** Control for this outcome, rendered beneath its description. */
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-cozy p-cozy',
        // THE ONE ROW THAT IS A DECISION, not a statement. Tinted so the red
        // control reads as belonging to the outcome it sits under rather than
        // as an alarm dropped into a reference list — and so a buyer scanning
        // the three outcomes can see at a glance which one they can act on.
        action && 'bg-destructive/5',
      )}
    >
      <Icon icon={Glyph}
        className={cn(
          'mt-0.5 size-4 shrink-0',
          action ? 'text-destructive' : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold">{title}</p>
        <p className="mt-0.5 text-body text-muted-foreground">{children}</p>
        {action ? <div className="mt-cozy">{action}</div> : null}
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
  reportAction,
}: {
  viewerIsBuyer: boolean;
  inPerson: boolean;
  /**
   * Trigger for the dispute dialog, rendered inside the "If the buyer reports a
   * problem" outcome — the row that already describes what pressing it does.
   *
   * Injected rather than built here because this component is presentational and
   * knows nothing about the sale it describes. Passed to the buyer during the
   * inspection window, and on a posted sale whose ship-by date passed with nothing
   * shipped (0132). Omit it for a seller, and once the inspection window has closed.
   */
  reportAction?: ReactNode;
}) {
  return (
    <section className="space-y-group" aria-labelledby="cash-sale-protection-title">
      <div>
        <h3 id="cash-sale-protection-title" className="text-lead font-semibold">
          How buyer protection works
        </h3>
        <p className="mt-tight text-body text-muted-foreground">
          {viewerIsBuyer ? 'Your payment' : "The buyer's payment"} stays with NoDitto
          {inPerson ? ' until the buyer confirms the handover' : ' through delivery and inspection'}.
          The seller can see that it is paid, but cannot receive it yet.
        </p>
      </div>

      {/* A BOX, NOT A `border-y` STACK. Two open rules top and bottom left the
          outcomes floating against the panel, and a tint on the actionable row
          had no edge to stop at. Enclosing the three makes them read as one
          table of outcomes and gives that tint a shape. */}
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        <ProtectionOutcome icon={CreditCardIcon} title="While the sale is active">
          The full payment remains held. {inPerson ? 'Meeting the seller' : 'Shipping the item'} does not
          release it.
        </ProtectionOutcome>
        <ProtectionOutcome
          icon={CheckCircleIcon}
          title={
            inPerson
              ? viewerIsBuyer
                ? 'When you confirm handover'
                : 'When the buyer confirms handover'
              : 'When the item is accepted'
          }
        >
          NoDitto releases the payment to the seller.
        </ProtectionOutcome>
        {/* SECOND PERSON FOR THE BUYER, matching the lede above. "If the buyer
            reports a problem" sitting directly over a button reading "Report a
            problem" described the reader in the third person while asking them
            to press it. */}
        <ProtectionOutcome
          icon={ShieldWarningIcon}
          title={viewerIsBuyer ? 'If you report a problem' : 'If the buyer reports a problem'}
          action={reportAction}
        >
          A dispute freezes the payment while support reviews both sides. Opening a
          dispute does not guarantee a refund.
        </ProtectionOutcome>
      </div>

      {!inPerson ? (
        <p className="flex gap-snug text-body text-muted-foreground">
          <Icon icon={TimerIcon} className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            If the buyer takes no action before the inspection deadline, the sale
            completes automatically and the seller is paid.
          </span>
        </p>
      ) : null}
    </section>
  );
}
