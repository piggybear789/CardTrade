// components/admin/CustodyPanel.tsx
//
// The solvency instrument: what the platform owes members, beside what the provider says
// it actually holds.
//
// WHY IT LEADS THE PAYOUTS TAB. Everything else on that tab is derived from our own
// tables — "this is what we believe we owe". This is the only figure on the console that
// the PROVIDER owns, so it is the only one that can contradict us. A chargeback, a
// provider fee, or an automatic payout sweeping the commingled balance into the
// platform's own bank account all move money without writing a row. Those are invisible
// everywhere else in the product.
//
// THREE STATES, AND `UNKNOWN` IS NOT GREEN. If the balance cannot be read the panel says
// so in plain terms rather than defaulting to reassurance. A monitoring panel that shows
// all-clear when its instrument is broken is worse than no panel: it converts an unknown
// into a false negative.

import { AlertTriangle, HelpCircle, ShieldCheck } from 'lucide-react';

import type { CustodyPosition } from '@/domain/payouts/custodyReconciliation';
import { formatMoney } from '@/lib/format';
import { regionLabel } from '@/domain/region';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface CustodyPanelProps {
  position: CustodyPosition & {
    /**
     * The Stripe platform account this position belongs to (0068).
     *
     * Named in the heading and folded into the element ids, because with more than
     * one region there is one of these panels per platform account and two unlabelled
     * solvency figures side by side are unreadable — and worse, mistakable for each
     * other.
     */
    region: string;
    currency: string;
    unreadableReason: string | null;
  };
}

export function CustodyPanel({ position }: CustodyPanelProps) {
  const {
    state,
    heldForMembersCents,
    providerBalanceCents,
    shortfallCents,
    surplusCents,
    saleCount,
    region,
    currency,
    unreadableReason,
  } = position;

  // Formatted in the platform account's OWN currency. Rendering a GBP balance with a
  // dollar sign would be a wrong number rather than a missing one, which on a
  // solvency panel is the more dangerous of the two.
  const money = (cents: number) => formatMoney(cents, currency);
  const headingId = `custody-heading-${region}`;

  const tone =
    state === 'SHORTFALL'
      ? {
          wrapper: 'border-destructive/40 bg-destructive/10',
          badge: 'destructive' as const,
          label: 'Shortfall',
          icon: <AlertTriangle className="size-4 shrink-0" aria-hidden />,
        }
      : state === 'SOLVENT'
        ? {
            wrapper: 'border-border bg-muted',
            badge: 'default' as const,
            label: 'Funds covered',
            icon: <ShieldCheck className="size-4 shrink-0" aria-hidden />,
          }
        : {
            wrapper: 'border-border bg-muted',
            badge: 'outline' as const,
            label: 'Unknown',
            icon: <HelpCircle className="size-4 shrink-0" aria-hidden />,
          };

  return (
    <section
      aria-labelledby={headingId}
      className={cn('mb-section rounded-lg border p-group', tone.wrapper)}
    >
      <div className="mb-cozy flex flex-wrap items-center gap-snug">
        {tone.icon}
        <h3 id={headingId} className="text-lead font-semibold">
          Money held for members — {regionLabel(region)}
        </h3>
        <Badge variant={tone.badge}>{tone.label}</Badge>
        <Badge variant="outline" className="uppercase">
          {currency}
        </Badge>
      </div>

      <dl className="grid gap-cozy sm:grid-cols-3">
        <div>
          <dt className="text-meta uppercase tracking-wide text-muted-foreground">
            Owed to members
          </dt>
          <dd className="mt-0.5 text-subhead font-semibold tabular-nums">
            {money(heldForMembersCents)}
          </dd>
          <p className="mt-0.5 text-body text-muted-foreground">
            Across {saleCount} {saleCount === 1 ? 'sale' : 'sales'} where money has been
            collected and not yet paid out or refunded.
          </p>
        </div>
        <div>
          <dt className="text-meta uppercase tracking-wide text-muted-foreground">
            Held at Stripe
          </dt>
          <dd className="mt-0.5 text-subhead font-semibold tabular-nums">
            {state === 'UNKNOWN' ? '—' : money(providerBalanceCents)}
          </dd>
          <p className="mt-0.5 text-body text-muted-foreground">
            Available plus pending. Card funds clear over days, so pending money is still
            money you hold.
          </p>
        </div>
        <div>
          <dt className="text-meta uppercase tracking-wide text-muted-foreground">
            {state === 'SHORTFALL' ? 'Short by' : 'Headroom'}
          </dt>
          <dd
            className={cn(
              'mt-0.5 text-subhead font-semibold tabular-nums',
              state === 'SHORTFALL' && 'text-destructive',
            )}
          >
            {state === 'UNKNOWN'
              ? '—'
              : money(state === 'SHORTFALL' ? shortfallCents : surplusCents)}
          </dd>
          <p className="mt-0.5 text-body text-muted-foreground">
            {state === 'SHORTFALL'
              ? 'You cannot currently pay everyone you owe.'
              : state === 'SOLVENT'
                ? 'Your own funds, above what is owed to members.'
                : 'Cannot be calculated without a balance reading.'}
          </p>
        </div>
      </dl>

      {state === 'SHORTFALL' ? (
        // Named causes, in the order they are actually likely. An operator seeing red
        // for the first time needs somewhere to look, not just a number.
        <div className="mt-group space-y-tight rounded-md border border-destructive/40 bg-destructive/10 p-cozy text-body text-destructive">
          <p className="font-semibold">
            Money members are owed is not all present. Check, in this order:
          </p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              <span className="font-medium">Automatic payouts.</span> If Stripe is
              sweeping the platform balance to your bank on a schedule, it is taking
              members&apos; funds with it — the balance is commingled. Stripe Dashboard →
              Settings → Payouts.
            </li>
            <li>
              <span className="font-medium">Chargebacks.</span> The platform is the
              losses collector, so a reversal comes out of this balance even when the
              seller has already been paid.
            </li>
            <li>
              <span className="font-medium">Provider fees</span> on collections and
              refunds.
            </li>
          </ol>
        </div>
      ) : null}

      {state === 'UNKNOWN' ? (
        <p className="mt-group rounded-md border border-border bg-card p-cozy text-body text-muted-foreground">
          The provider balance could not be read, so this cannot be verified either way.
          {unreadableReason ? ` Reason: ${unreadableReason}.` : ''} With the mock provider
          there is no real balance to check — this reads as unknown by design rather than
          reporting a reassuring figure for simulated money.
        </p>
      ) : null}
    </section>
  );
}
