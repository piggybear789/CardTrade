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
  Lock,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Undo2,
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
        'rounded-lg border p-cozy',
        tone === 'success' && 'border-emerald-500/30 bg-emerald-500/5',
        tone === 'warning' && 'border-amber-500/30 bg-amber-500/5',
      )}
    >
      {/* Badge centred against the whole row, matching `CustodyBox` below. See the
          note there: it is deliberate, not the first-line convention. */}
      <div className="flex items-center gap-snug">
        <span
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-full border bg-background',
            tone === 'success' && 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
            tone === 'warning' && 'border-amber-500/40 text-amber-700 dark:text-amber-400',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <div className="mt-0.5 text-meta text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Explains the collateral lifecycle and resolution outcomes in a Trade contract. */
export function DittoBondExplainer() {
  return (
    <section
      className="space-y-cozy rounded-xl border bg-muted/20 p-cozy"
      aria-labelledby="dittobond-title"
    >
      <div>
        <h3 id="dittobond-title" className="text-body font-semibold">
          How trade collateral works
        </h3>
        <p className="mt-1 text-meta text-muted-foreground">
          Trade collateral is a temporary card authorisation that backs a trade. It is not
          a charge, and NoDitto does not receive the authorised amount while the trade
          is proceeding normally.
        </p>
      </div>

      <div className="grid gap-snug sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-stretch">
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

      <div className="grid gap-snug border-t pt-cozy text-meta sm:grid-cols-2">
        <div className="space-y-1">
          <p className="font-medium text-foreground">If something goes wrong</p>
          <p className="text-muted-foreground">
            A failed handover captures nothing. A condition dispute can capture a
            fixed $20 resolution fee; confirmed fraud can capture the responsible
            trader&apos;s full collateral and pay the affected trader.
          </p>
        </div>
        <div className="flex gap-snug rounded-md bg-background/70 p-snug">
          <Timer className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
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


/** One box on the cash-sale custody diagram: who has the money, and while what. */
function CustodyBox({
  icon: Icon,
  title,
  detail,
  held = false,
}: {
  icon: typeof CreditCard;
  title: string;
  detail: string;
  /** The one box where the money is sitting rather than moving. */
  held?: boolean;
}) {
  // The badge centres against the WHOLE row — title plus description — not against
  // the title line. Stated here because it is a deliberate choice and reads as a bug
  // to the usual convention: a badge beside a title-plus-prose is normally aligned to
  // the first line, on the grounds that an icon labels the heading rather than the
  // paragraph. These rows are short (one line of title, one or two of detail) and each
  // one is a single unit in a diagram, so the badge belongs on the unit's axis.
  return (
    <div className="flex min-w-0 items-center gap-snug">
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full border',
          held
            ? 'border-trust/45 bg-trust/10 text-trust'
            : 'border-border bg-background text-foreground',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-body font-semibold leading-tight">{title}</p>
        <p className="mt-0.5 text-meta leading-4 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

/**
 * Explains where a Cash_Sale buyer's money sits, and when the Seller is paid.
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
 * THREE BOXES, ONE FORK, AND NO LEGEND. Two earlier versions both failed the same
 * way: they were built around the sale's four STAGES (pay, ship, inspect, resolve),
 * which meant the diagram had to say "the money has not moved" three times — once
 * as repeated "MONEY — Held by NoDitto" rows, then as a band spanning three
 * columns with the sentences repeated underneath as a legend. Every stage label
 * appeared twice on screen.
 *
 * A member asking "where is my money" is asking about CUSTODY, and custody only has
 * three positions: yours, ours, or theirs. Shipping and inspection are not custody
 * changes — they are what happens WHILE we hold it, so they belong inside the middle
 * box as one clause. That collapses the whole explanation to a payment, a hold, and
 * a two-way fork, with no fact stated twice and no legend to keep in step.
 */
export function CashSaleProtectionExplainer() {
  return (
    <div className="space-y-group">
      {/* One `role="img"` carrying the whole journey. The labels are real text and
          are fine to read, but a graphics role suppresses them for assistive tech,
          so the label has to be the complete answer on its own. */}
      <div
        className={cn(
          'grid gap-cozy',
          'sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.1fr)_auto_minmax(0,1.2fr)] sm:items-center',
        )}
        role="img"
        aria-label="You pay the full amount up front. NoDitto holds it while the seller posts the item and you check it over. The seller is paid when you accept or the inspection window closes; if you dispute inside the window, a person reviews it and you can be refunded."
      >
        <CustodyBox
          icon={CreditCard}
          title="You pay"
          detail="The full amount, up front."
        />

        <ArrowRight
          className="mx-auto size-4 shrink-0 rotate-90 text-muted-foreground sm:rotate-0"
          aria-hidden
        />

        <CustodyBox
          icon={Lock}
          title="NoDitto holds it"
          detail="While the seller posts it and you check it over."
          held
        />

        <ArrowRight
          className="mx-auto size-4 shrink-0 rotate-90 text-muted-foreground sm:rotate-0"
          aria-hidden
        />

        {/* THE FORK. Two outcomes from one position, so they share a bracket rather
            than sitting in the flow as two more steps — the money goes to exactly
            one of them. */}
        <div className="space-y-cozy border-l pl-cozy">
          <CustodyBox
            icon={CheckCircle2}
            title="Seller is paid"
            detail="When you accept, or the inspection window closes."
          />
          <CustodyBox
            icon={Undo2}
            title="Or you are refunded"
            detail="Dispute inside the window and a person reviews it."
          />
        </div>
      </div>

      <div className="flex items-start gap-snug border-t pt-cozy">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-trust" aria-hidden />
        <p className="text-meta text-muted-foreground">
          <span className="font-medium text-foreground">Every seller is verified</span>{' '}
          — photo ID + selfie via Stripe before they can list anything.
        </p>
      </div>
    </div>
  );
}
