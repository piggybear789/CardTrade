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
import { HugeiconsIcon } from '@hugeicons/react';
import { AlertCircleIcon, CheckIcon, CheckmarkCircle02Icon, CreditCardIcon, ShieldAlertIcon, Timer01Icon, XIcon } from '@hugeicons/core-free-icons';

import { FRICTION_TAX_CENTS } from '@/domain/dispute/frictionTax';
import { formatAud } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * What each ending does to your collateral, as a table rather than a paragraph.
 *
 * `Up to`, not a flat figure: the Friction_Tax is capped at what was authorised
 * (`frictionTaxChargeableCents`), so a trade on a $5 item cannot be charged $20
 * and the copy must not promise otherwise. The amount is read from the constant
 * so this line cannot drift from the one that is actually captured.
 */
const OUTCOMES: {
  icon: typeof CheckIcon;
  tone: string;
  event: string;
  result: string;
  note?: string;
}[] = [
  {
    icon: CheckIcon,
    tone: 'text-trust',
    event: 'The trade completes',
    result: 'Released',
  },
  {
    icon: CheckIcon,
    tone: 'text-trust',
    event: 'The handover fails',
    result: 'Released',
  },
  {
    icon: AlertCircleIcon,
    tone: 'text-iris-ink',
    event: 'A condition dispute',
    result: `Up to ${formatAud(FRICTION_TAX_CENTS)}`,
    note: "Covers the other trader's return postage.",
  },
  {
    icon: XIcon,
    tone: 'text-destructive',
    event: 'Confirmed fraud',
    result: 'The full amount',
    note: 'Paid to the trader who was defrauded.',
  },
];

/**
 * The two things a trader needs to know about collateral beyond what the tab's
 * own opening line says: what it does to their card, and what happens if the
 * trade goes wrong.
 *
 * IT USED TO BE A THREE-STEP FLOW, twice. Authorise → Trade with protection →
 * Release, rendered once as a stacked list for small screens and again as a
 * connector rail for large ones — the same three paragraphs present in the DOM
 * simultaneously — under a heading and a lede that restated the tab's own
 * explainer. Seven paragraphs of tutorial stood between opening the Collateral
 * tab and seeing what was actually held.
 *
 * The steps were narrating a process the reader cannot act on and can already
 * see the state of in the hold list. What they carried that the list does not
 * is now one sentence: the balance dips, nothing is charged, the holds void.
 * The consequences below it stay in full, because those are the facts that are
 * genuinely surprising and genuinely matter.
 */
export function DittoBondExplainer() {
  return (
    <section className="space-y-cozy text-body" aria-labelledby="dittobond-title">
      {/* The tab is labelled "Collateral" and opens with its own explainer
          sentence, so a visible heading here would be the third title on one
          screen. Kept for the document outline. */}
      <h3 id="dittobond-title" className="sr-only">
        What happens to your collateral
      </h3>

      <div className="overflow-hidden rounded-md border border-border">
        <div className="flex items-center gap-cozy border-b bg-muted px-cozy py-snug">
          <p className="market-label min-w-0 flex-1 text-muted-foreground">
            How it ends
          </p>
          <p className="market-label shrink-0 text-muted-foreground">
            Your collateral
          </p>
        </div>
        <ul className="divide-y divide-border">
          {OUTCOMES.map(({ icon: Icon, tone, event, result, note }) => (
            <li
              key={event}
              className="flex items-start gap-cozy px-cozy py-snug"
            >
              <HugeiconsIcon icon={Icon} className={cn('mt-0.5 size-4 shrink-0', tone)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{event}</p>
                {note ? (
                  <p className="text-meta text-muted-foreground">{note}</p>
                ) : null}
              </div>
              <p className="shrink-0 text-right font-medium tabular-nums">
                {result}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <p className="flex items-start gap-snug text-muted-foreground">
        <HugeiconsIcon icon={Timer01Icon} className="mt-0.5 size-4 shrink-0" aria-hidden />
        Authorisations expire about seven days after they are placed, so the trade
        has to finish before then.
      </p>
    </section>
  );
}

function ProtectionOutcome({
  icon: Icon,
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
      <HugeiconsIcon icon={Icon}
        className={cn(
          'mt-0.5 size-4 shrink-0',
          action ? 'text-destructive' : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold">{title}</p>
        <p className="mt-0.5 text-body leading-relaxed text-muted-foreground">{children}</p>
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
   * knows nothing about the sale it describes. Omit it for a seller, or once the
   * inspection window has closed.
   */
  reportAction?: ReactNode;
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
          icon={CheckmarkCircle02Icon}
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
          icon={ShieldAlertIcon}
          title={viewerIsBuyer ? 'If you report a problem' : 'If the buyer reports a problem'}
          action={reportAction}
        >
          A dispute freezes the payment while support reviews both sides. Opening a
          dispute does not guarantee a refund.
        </ProtectionOutcome>
      </div>

      {!inPerson ? (
        <p className="flex gap-snug text-body leading-relaxed text-muted-foreground">
          <HugeiconsIcon icon={Timer01Icon} className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            If the buyer takes no action before the inspection deadline, the sale
            completes automatically and the seller is paid.
          </span>
        </p>
      ) : null}
    </section>
  );
}
