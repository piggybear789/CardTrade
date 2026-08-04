// components/payouts/PayoutsDashboard.tsx
//
// The member-facing Payouts_Dashboard (Req 3, 4, 5, 6, 7, 10, 11).
//
// A Server Component: every figure is derived on the server by
// `getPayoutsDashboard`, so nothing here recomputes money from partial data. The
// only interactive part is the payout-setup link, which is an ordinary anchor.
//
// FOUR SECTIONS IN A FIXED ORDER (Req 1.5): what is being released now, where it
// is going, what has already moved, and what is under arbitration.
//
// WORDING IS LOAD-BEARING. The reference dashboard this is modelled on labels its
// headline "Available Now", which implies a withdraw button. CardTrade has no
// per-member provider balance and no withdrawal endpoint — a release is queued
// automatically and drained by an hourly job — so the headline is "Releasing now"
// and there is deliberately no cash-out control anywhere on this page (Req 1.8).
// Likewise a settled release is described as SENT, never as arrived or received:
// once the provider has it, the timing belongs to the bank.

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Clock,
  Scale,
  ShieldCheck,
} from 'lucide-react';

import type {
  ArbitrationRecord,
  PayoutReadModel,
  ReleaseFailureCause,
  TransferHistoryEntry,
} from '@/domain/payouts/payoutReadModel';
import type { DestinationAccount } from '@/lib/actions/payouts';
import { formatAud, formatRelativeTime } from '@/lib/format';
import {
  SectionFilter,
  partitionByScope,
  type SectionScope,
} from '@/components/layout/SectionFilter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

/** Member-safe explanation and next step for each failure cause (Req 6.1-6.4). */
const FAILURE_COPY: Record<
  ReleaseFailureCause,
  { summary: string; action: string; href?: string; actionLabel?: string }
> = {
  NOT_PAYABLE: {
    summary: 'Your payout setup is not finished, so we have nowhere to send this yet.',
    action: 'Finish payout setup and we will release it automatically.',
    href: '/profile#payouts',
    actionLabel: 'Finish payout setup',
  },
  PROVIDER_REJECTED: {
    summary: 'Our payment provider rejected this release.',
    action: 'We are retrying it automatically. Nothing is needed from you.',
  },
  RETRIES_EXHAUSTED: {
    summary: 'Automatic retries for this release have stopped.',
    action: 'A CardTrade operator is reviewing it. Your money is still held for you.',
  },
};

/** One-line description of a history entry (Req 5.3, 5.6, 5.11). */
function historySentence(entry: TransferHistoryEntry): string {
  const amount = formatAud(entry.amountCents);
  const item = entry.itemTitle ? ` for ${entry.itemTitle}` : '';
  switch (entry.kind) {
    case 'QUEUED':
      return `${amount}${item} is queued for release.`;
    case 'SENT':
      return `${amount}${item} was sent to your payout account.`;
    case 'FAILED':
      return `${amount}${item} could not be sent yet.`;
    case 'FRAUD_RESTITUTION':
      return `${amount} of captured collateral was paid to you as the affected party.`;
  }
}

/** What an arbitration means for the Member's money (Req 7.3-7.8). */
function arbitrationSentence(record: ArbitrationRecord): string {
  switch (record.effect) {
    case 'PROCEEDS_HELD':
      return 'The proceeds are held until this is resolved.';
    case 'FRICTION_TAX_CAPTURED':
      return 'A $20 resolution fee was captured: $10 return shipping to the other party and $10 platform fee.';
    case 'COLLATERAL_CAPTURED_FROM_ME':
      return 'Your collateral was captured in full.';
    case 'COLLATERAL_PAID_TO_ME':
      return "The other party's collateral was captured in full and paid to you.";
    case 'FUNDS_REVERSED':
      return "The funds were reversed by the payer's bank.";
    case 'NO_FUNDS_MOVED':
      return 'No funds moved.';
    case 'AWAITING_OUTCOME':
      return 'An outcome is still owed.';
  }
}

/** Human label for each arbitration kind. */
const ARBITRATION_LABEL: Record<ArbitrationRecord['kind'], string> = {
  CASH_SALE_DISPUTE: 'Sale dispute',
  TRADE_DISPUTE: 'Trade dispute',
  TRADE_FRAUD: 'Fraud resolution',
  CHARGEBACK: 'Chargeback',
};

/** Presentation for each verification state (Req 4.2, 4.8, 10.3-10.5). */
const DESTINATION_COPY: Record<
  DestinationAccount['state'],
  { badge: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; detail: string }
> = {
  VERIFIED: {
    badge: 'Ready',
    variant: 'default',
    detail: 'Your payout account is active, so releases can be sent.',
  },
  IN_PROGRESS: {
    badge: 'In progress',
    variant: 'secondary',
    detail:
      'Payout approval is still in progress. Anything owed to you will be released automatically once it completes.',
  },
  NOT_STARTED: {
    badge: 'Not started',
    variant: 'outline',
    detail: 'You have not set up payouts yet, so we have nowhere to send your proceeds.',
  },
  NOT_APPROVED: {
    badge: 'Not approved',
    variant: 'destructive',
    detail: 'Your payout setup was not approved. You can start it again below.',
  },
};

export interface PayoutsDashboardProps {
  model: PayoutReadModel;
  destination: DestinationAccount;
  /** Which slice of the Transfer_History to show. URL-driven via `?show=`. */
  scope: SectionScope;
}

export function PayoutsDashboard({ model, destination, scope }: PayoutsDashboardProps) {
  return (
    <div className="space-y-10">
      <BalanceSummary model={model} />
      <DestinationAccountSummary destination={destination} />
      <TransferHistory model={model} scope={scope} />
      <ArbitrationSummary model={model} />
    </div>
  );
}

/**
 * A history entry is "past" once the money has finished moving.
 *
 * QUEUED and FAILED are still live — something is owed and either in flight or
 * stuck — so they belong with what needs attention. SENT and FRAUD_RESTITUTION are
 * done. This is the same active/past distinction the rest of the workspace uses,
 * which is why it reuses `SectionFilter` rather than inventing pagination.
 */
function isHistoryPast(entry: TransferHistoryEntry): boolean {
  return entry.kind === 'SENT' || entry.kind === 'FRAUD_RESTITUTION';
}

function BalanceSummary({ model }: { model: PayoutReadModel }) {
  // A page of zeroes reads as an error, so a member who has never sold gets an
  // explanation instead of the figures (Req 10.1, 10.2).
  if (model.noSales) {
    return (
      <section aria-labelledby="balance-heading">
        <h3 id="balance-heading" className="sr-only">
          Balance
        </h3>
        <EmptyState
          icon={<Banknote className="size-6" aria-hidden />}
          title="No Sales Yet"
          titleAs="h4"
          description="Once a buyer pays for one of your listings, the money appears here and is released to you automatically when they accept the item."
          action={{ label: 'Create a listing', href: '/listings/new' }}
          compact
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="balance-heading">
      <h3 id="balance-heading" className="mb-4 text-xl font-semibold">
        Your money
      </h3>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>Releasing now</CardDescription>
          <CardTitle className="text-3xl tabular-nums">
            {formatAud(model.releasingNowCents)}
          </CardTitle>
          <CardDescription>
            Owed to you and already queued. Released automatically — there is
            nothing for you to click.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Upcoming
              </dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                {formatAud(model.upcomingProceedsCents)}
              </dd>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Buyer has paid and we are holding it. Becomes releasable when they
                accept the item or the inspection window closes.
              </p>
            </div>
            {model.atRiskProceedsCents > 0 ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Under dispute
                </dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                  {formatAud(model.atRiskProceedsCents)}
                </dd>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Counted in neither figure above while an outcome is owed. See
                  disputes below.
                </p>
              </div>
            ) : null}
          </dl>

          <p className="text-xs text-muted-foreground">
            Every figure is what you receive, after the 5% platform fee on the
            agreed item price. Shipping is passed straight through to the carrier
            and is not revenue. Amounts count only money already collected from a
            buyer.
          </p>

          {model.hasBlockedRelease ? (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Part of this is blocked. The reason and what fixes it are listed
                below.
              </span>
            </p>
          ) : null}

          {model.releasing.length > 0 ? (
            <ul className="divide-y rounded-lg border">
              {model.releasing.map((row) => {
                const copy = row.failureCause ? FAILURE_COPY[row.failureCause] : null;
                return (
                  <li key={row.cashSaleId} className="p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={`/sales/${row.cashSaleId}`}
                        className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
                      >
                        {row.itemTitle}
                      </Link>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {formatAud(row.netCents)}
                      </span>
                    </div>
                    {copy ? (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-xs text-destructive">{copy.summary}</p>
                        <p className="text-xs text-muted-foreground">{copy.action}</p>
                        <p className="text-xs text-muted-foreground">
                          Your money stays held by CardTrade for you. You do not need
                          to re-sell or re-invoice.
                        </p>
                        {copy.href ? (
                          <Button asChild size="sm" variant="outline" className="mt-1">
                            <Link href={copy.href}>{copy.actionLabel}</Link>
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="size-3.5 shrink-0" aria-hidden />
                        Queued for release.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

function DestinationAccountSummary({ destination }: { destination: DestinationAccount }) {
  const copy = DESTINATION_COPY[destination.state];
  const needsSetup = destination.state !== 'VERIFIED';

  return (
    <section aria-labelledby="destination-heading">
      <h3 id="destination-heading" className="mb-4 text-xl font-semibold">
        Where your money goes
      </h3>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <CardTitle className="text-base">
              {destination.verifiedName ?? 'Your payout account'}
            </CardTitle>
            <Badge variant={copy.variant}>{copy.badge}</Badge>
          </div>
          <CardDescription>{copy.detail}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* No BSB, no account number, no masked digits. Stripe collects and holds
              settlement details in its own hosted flow; we never receive them, so
              there is nothing here to mask (Req 4.5, 4.7). */}
          <p className="text-xs text-muted-foreground">
            Your bank details are collected and held by our payment provider.
            CardTrade never receives or stores them, so they cannot be shown or
            edited here.
          </p>

          {destination.hostedOnboarding ? (
            <Button asChild variant="outline">
              <Link href="/profile#payouts">
                {needsSetup ? 'Set up payouts' : 'Update payout details'}
                <ArrowUpRight aria-hidden />
              </Link>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Payout details are managed by our payment provider.
            </p>
          )}

          {destination.state === 'VERIFIED' ? (
            <p className="text-xs text-muted-foreground">
              Once a release is sent it can take up to four business days to appear
              in your account. That timing is your bank&apos;s, not ours.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

function TransferHistory({
  model,
  scope,
}: {
  model: PayoutReadModel;
  scope: SectionScope;
}) {
  const { active, past } = partitionByScope([...model.history], isHistoryPast);
  const shown = scope === 'past' ? past : active;

  return (
    <section aria-labelledby="history-heading">
      <h3 id="history-heading" className="mb-4 text-xl font-semibold">
        Transfer history
      </h3>

      {model.history.length > 0 ? (
        <SectionFilter
          scope={scope}
          basePath="/profile/payouts"
          activeCount={active.length}
          pastCount={past.length}
        />
      ) : null}

      {model.history.length === 0 ? (
        <EmptyState
          title="Nothing Has Moved Yet"
          titleAs="h4"
          description="The first entry appears when a buyer accepts an item and your proceeds are queued for release."
          compact
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title={scope === 'past' ? 'Nothing Completed Yet' : 'Nothing In Progress'}
          titleAs="h4"
          description={
            scope === 'past'
              ? 'No transfer has finished moving yet. Anything in progress is under Active.'
              : 'Every transfer has finished. Completed movements are under Past.'
          }
          compact
        />
      ) : (
        <ol className="space-y-3">
          {shown.map((entry) => (
            <li key={entry.id} className="border-l-2 border-border pl-4">
              <p className="text-sm">
                {historySentence(entry)}
                {entry.kind === 'SENT' ? (
                  <span className="font-medium">
                    {' '}
                    This can take up to four business days to appear in your account.
                  </span>
                ) : null}
              </p>
              {entry.kind === 'FAILED' && entry.failureCause ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {FAILURE_COPY[entry.failureCause].summary}
                </p>
              ) : null}
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {formatRelativeTime(entry.occurredAt)}
                </span>
                {entry.cashSaleId ? (
                  <Link
                    href={`/sales/${entry.cashSaleId}`}
                    className="text-xs underline underline-offset-2 hover:text-foreground"
                  >
                    View sale
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ArbitrationSummary({ model }: { model: PayoutReadModel }) {
  return (
    <section aria-labelledby="arbitration-heading">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h3 id="arbitration-heading" className="text-xl font-semibold">
          Disputes affecting your money
        </h3>
        {model.atRiskProceedsCents > 0 ? (
          <Badge variant="outline">{formatAud(model.atRiskProceedsCents)} at risk</Badge>
        ) : null}
      </div>

      {model.arbitrations.length === 0 ? (
        <EmptyState
          title="No Disputes"
          titleAs="h4"
          description="No disputes or fraud resolutions are affecting your money."
          compact
        />
      ) : (
        <ul className="space-y-4">
          {model.arbitrations.map((record) => {
            const href = record.cashSaleId
              ? `/sales/${record.cashSaleId}`
              : record.tradeId
                ? `/trades/${record.tradeId}`
                : null;
            return (
              <li key={record.id}>
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Scale className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <CardTitle className="text-base">
                          {ARBITRATION_LABEL[record.kind]}
                        </CardTitle>
                        <Badge variant={record.open ? 'destructive' : 'secondary'}>
                          {record.open ? 'Open' : 'Closed'}
                        </Badge>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {formatAud(record.amountCents)}
                      </span>
                    </div>
                    <CardDescription>
                      {arbitrationSentence(record)}
                      {record.kind === 'CASH_SALE_DISPUTE'
                        ? record.raisedByMe
                          ? ' You raised this.'
                          : ' The buyer raised this.'
                        : ''}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {record.reason ? (
                      <p className="whitespace-pre-line break-words rounded-md border bg-muted/40 p-2 text-xs">
                        {record.reason}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      {record.occurredAt ? (
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(record.occurredAt)}
                        </span>
                      ) : null}
                      {href ? (
                        <Link
                          href={href}
                          className="text-xs underline underline-offset-2 hover:text-foreground"
                        >
                          View contract
                        </Link>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {model.atRiskProceedsCents > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          An amount at risk appears in neither &ldquo;Releasing now&rdquo; nor
          &ldquo;Upcoming&rdquo; while an outcome is owed.
        </p>
      ) : null}
    </section>
  );
}
