// components/payouts/AccountStatement.tsx
//
// The member's Account_Statement as a TABLE. See `domain/statement` for what a row
// is; this file only decides how one reads.
//
// A TABLE, NOT SENTENCES. The transfer history this replaces rendered each event
// as prose — "$95.00 for Pikachu was sent to your payout account." — so comparing
// any two rows meant reading both. Money is columnar: date, what, how much, which
// way, where it stands. From `md` this is a real `<table>`; on a phone the same
// rows collapse to two lines each (description and status, then amount and date)
// so nothing scrolls sideways.
//
// SIGNED AMOUNTS, ONE COLUMN. `+$95.00` in ink, `−$105.00` muted, and a hold as
// `$200.00 held` — direction is read from the sign and the word, not from which
// column the figure landed in. Gross and fee are supporting detail under the
// description on the rows that have them, not columns of their own: most rows
// (fees, holds, captures) have neither, and two mostly-empty columns is noise.
//
// Server Component. Nothing here is interactive except links.

import Link from 'next/link';

import type {
  AccountStatement as AccountStatementModel,
  StatementEntry,
  StatementKind,
  StatementStatus,
} from '@/domain/statement/accountStatement';
import { formatAud, formatShortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  SectionFilter,
  partitionByScope,
  type SectionScope,
} from '@/components/layout/SectionFilter';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';

const KIND_LABEL: Record<StatementKind, string> = {
  PURCHASE: 'Purchase',
  REFUND: 'Refund',
  SALE: 'Sale',
  TRADE_FEE: 'Trade fee',
  COLLATERAL: 'Collateral',
  RESOLUTION_FEE: 'Resolution fee',
  COLLATERAL_CAPTURED: 'Collateral captured',
  RESTITUTION: 'Paid to you',
  CHARGEBACK: 'Chargeback',
};

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'trust' | 'outline';

const STATUS_META: Record<StatementStatus, { label: string; variant: BadgeVariant }> = {
  PENDING: { label: 'Pending', variant: 'secondary' },
  HELD: { label: 'Held', variant: 'default' },
  SENT: { label: 'Sent', variant: 'trust' },
  PAID: { label: 'Paid', variant: 'trust' },
  RELEASED: { label: 'Released', variant: 'outline' },
  CAPTURED: { label: 'Captured', variant: 'destructive' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  REFUNDED: { label: 'Refunded', variant: 'outline' },
  REVERSED: { label: 'Reversed', variant: 'destructive' },
  EXPIRED: { label: 'Expired', variant: 'destructive' },
  DISMISSED: { label: 'Dismissed', variant: 'outline' },
};

/** `+$95.00`, `−$105.00`, or `$200.00 held`. */
function SignedAmount({ entry, className }: { entry: StatementEntry; className?: string }) {
  const amount = formatAud(entry.amountCents);
  if (entry.direction === 'HOLD') {
    return (
      <span className={cn('tabular-nums text-muted-foreground', className)}>
        {amount} <span className="text-meta">held</span>
      </span>
    );
  }
  const positive = entry.direction === 'IN';
  return (
    <span
      className={cn(
        'tabular-nums',
        positive ? 'font-semibold text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      {positive ? '+' : '\u2212'}
      {amount}
    </span>
  );
}

/** Gross and fee, where the row has them. One line, muted. */
function Breakdown({ entry }: { entry: StatementEntry }) {
  if (entry.grossCents == null || entry.feeCents == null) return null;
  if (entry.feeCents === 0) return null;
  const gross = formatAud(entry.grossCents);
  const fee = formatAud(entry.feeCents);
  return (
    <span className="text-meta tabular-nums text-muted-foreground">
      {entry.kind === 'PURCHASE' ? `${gross} + ${fee} fees` : `${gross} \u2212 ${fee} fee`}
    </span>
  );
}

function StatusBadge({ status }: { status: StatementStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant={meta.variant} className="shrink-0">
      {meta.label}
    </Badge>
  );
}

function Description({ entry }: { entry: StatementEntry }) {
  return (
    <div className="min-w-0">
      <Link
        href={entry.href}
        transitionTypes={['nav-forward']}
        className="block truncate text-body font-medium text-foreground underline-offset-2 hover:underline"
      >
        {entry.label}
      </Link>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-snug text-meta text-muted-foreground">
        <span>{KIND_LABEL[entry.kind]}</span>
        {entry.counterpartyName && entry.kind !== 'TRADE_FEE' && entry.kind !== 'COLLATERAL' ? (
          <span className="truncate">· {entry.counterpartyName}</span>
        ) : null}
        <Breakdown entry={entry} />
      </div>
    </div>
  );
}

export function AccountStatement({
  statement,
  scope,
}: {
  statement: AccountStatementModel;
  scope: SectionScope;
}) {
  const { active, past } = partitionByScope([...statement.entries], (e) => e.settled);
  const shown = scope === 'past' ? past : active;
  const { receivedCents, spentCents, heldCents } = statement.totals;

  return (
    // ONE WHITE CARD. The heading, the totals, the filter and the rows are one object
    // — "your payment activity" — rather than a muted label floating over a table on
    // the tinted page, which read as a stray section rather than a thing.
    <section
      aria-labelledby="statement-heading"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-cozy gap-y-tight border-b border-border px-group py-cozy">
        <div>
          <h3 id="statement-heading" className="text-subhead font-semibold tracking-tight">
            Payment activity
          </h3>
          <p className="text-meta text-muted-foreground">
            Everything you have paid, received or had held
          </p>
        </div>
        {/* THE THREE TOTALS, ONCE. Received and spent are money that actually moved;
            held is collateral still authorised. They are not a balance — there is no
            member balance on this platform — so they are not summed. */}
        {statement.entries.length > 0 ? (
          <dl className="flex flex-wrap gap-x-group gap-y-tight text-meta tabular-nums text-muted-foreground">
            <div className="flex gap-tight">
              <dt>Received</dt>
              <dd className="font-semibold text-foreground">{formatAud(receivedCents)}</dd>
            </div>
            <div className="flex gap-tight">
              <dt>Spent</dt>
              <dd className="font-semibold text-foreground">{formatAud(spentCents)}</dd>
            </div>
            {heldCents > 0 ? (
              <div className="flex gap-tight">
                <dt>Held</dt>
                <dd className="font-semibold text-foreground">{formatAud(heldCents)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>

      {statement.entries.length > 0 ? (
        <div className="px-group pt-snug">
          <SectionFilter
            scope={scope}
            basePath="/profile?tab=payouts"
            activeCount={active.length}
            pastCount={past.length}
          />
        </div>
      ) : null}

      {statement.entries.length === 0 ? (
        // `px-group` on a wrapper: `EmptyState` sheds its own inset below `md` to
        // sit flush with page rows, which inside a card leaves the copy against
        // the edge.
        <div className="px-group">
          <EmptyState
            title="Nothing has moved yet"
            titleAs="h4"
            description="Purchases, sales, trade fees and collateral appear here as they happen."
            className="border-0 py-section"
            compact
          />
        </div>
      ) : shown.length === 0 ? (
        <div className="px-group">
          <EmptyState
            className="border-0"
            title={scope === 'past' ? 'Nothing settled yet' : 'Nothing in progress'}
            titleAs="h4"
            description={
              scope === 'past'
                ? 'Anything still moving is under Active.'
                : 'Everything has settled. Completed entries are under Past.'
            }
            compact
          />
        </div>
      ) : (
        <div className="border-t border-border">
          {/* DESKTOP: a table. Column widths are fixed so rows align across pages
              of the filter and the amount column does not drift with content. */}
          <table className="hidden w-full md:table">
            <thead>
              <tr className="border-b border-border text-left text-meta text-muted-foreground">
                <th scope="col" className="w-28 px-group py-snug font-medium">
                  Date
                </th>
                <th scope="col" className="px-group py-snug font-medium">
                  Description
                </th>
                <th scope="col" className="w-36 px-group py-snug text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="w-32 px-group py-snug font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-group py-cozy align-top text-body tabular-nums text-muted-foreground">
                    <time dateTime={entry.occurredAt}>{formatShortDate(entry.occurredAt)}</time>
                  </td>
                  <td className="max-w-0 px-group py-cozy align-top">
                    <Description entry={entry} />
                  </td>
                  <td className="px-group py-cozy text-right align-top text-body">
                    <SignedAmount entry={entry} />
                  </td>
                  <td className="px-group py-cozy align-top">
                    <StatusBadge status={entry.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* PHONE: the same rows, two lines each. */}
          <ol className="divide-y divide-border md:hidden">
            {shown.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-cozy px-group py-cozy">
                <Description entry={entry} />
                <div className="flex shrink-0 flex-col items-end gap-tight">
                  <SignedAmount entry={entry} className="text-body" />
                  <StatusBadge status={entry.status} />
                  <time
                    dateTime={entry.occurredAt}
                    className="text-meta tabular-nums text-muted-foreground"
                  >
                    {formatShortDate(entry.occurredAt)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {shown.some((e) => e.kind === 'SALE' && e.status === 'SENT') ? (
        <p className="border-t border-border px-group py-snug text-meta text-muted-foreground">
          Sent transfers can take up to four business days to reach your bank.
        </p>
      ) : null}
    </section>
  );
}
