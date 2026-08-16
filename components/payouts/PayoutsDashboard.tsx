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
    // Says PAYOUT SETUP, not "not verified". Since 0069 "verified" means the identity
    // check, and this member may well have passed it — a payable-but-unverified or
    // verified-but-unpayable member are both normal states. Reusing the word here
    // told a verified seller they were unverified.
    summary: 'Your payout setup is not finished, so we have nowhere to send this.',
    action: 'Finish Stripe Connect setup and we will release it automatically.',
    href: '/profile/payouts',
    actionLabel: 'Open Stripe Connect setup',
  },
  PROVIDER_REJECTED: {
    summary: 'Our payment provider rejected this release.',
    action: 'We are retrying it automatically. Nothing is needed from you.',
  },
  RETRIES_EXHAUSTED: {
    summary: 'Automatic retries for this release have stopped.',
    action: 'A CardTrade operator is reviewing it. Your funds are safe and release will be retried.',
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
      return 'The proceeds are paused until this is resolved.';
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
    <div className="space-y-section font-sans">
      <BalanceSummary model={model} />
      <ActiveSalesSummary model={model} />
      {/* ONE payout destination card, not two.
          
          The Identity and Connect cards now live side-by-side in the page-level
          grid above this dashboard. The standalone destination section earns its
          place only once VERIFIED, because that is the only state where it reports
          something the setup card cannot: `verifiedName`, the actual account the
          money lands in. Before then "where your money goes" has no answer, and
          the Connect card in the grid above is the one with the action. */}
      {destination.state === 'VERIFIED' ? (
        <DestinationAccountSummary destination={destination} />
      ) : null}
      <TransferHistory model={model} scope={scope} />
      {model.arbitrations.length > 0 || model.atRiskProceedsCents > 0 ? (
        <ArbitrationSummary model={model} />
      ) : null}
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
          Pending payouts
        </h3>
        <Card className="h-full">
          <CardHeader className="p-4">
            <p className="font-sans text-meta text-muted-foreground">Owed to you</p>
            <p className="display-value mt-4 text-subhead">{formatAud(0)}</p>
            <p className="mt-1 font-sans text-meta text-muted-foreground">
              Funds are released after a contract resolves.
            </p>
          </CardHeader>
        </Card>
      </section>
    );
  }

  return (
    <section aria-labelledby="balance-heading" className="h-full">
      <h3 id="balance-heading" className="sr-only">
        Pending payouts
      </h3>

      <Card className="h-full">
        <CardHeader className="pb-3">
          <p className="font-sans text-meta text-muted-foreground">Owed to you</p>
          <p className="display-value mt-4 text-subhead">
            {formatAud(model.releasingNowCents)}
          </p>
          <p className="mt-1 font-sans text-meta text-muted-foreground">
            Queued and released automatically.
          </p>
        </CardHeader>
        <CardContent className="space-y-group">
          <dl className="grid gap-group sm:grid-cols-2">
            <div>
              <dt className="text-meta uppercase tracking-wide text-muted-foreground">
                Upcoming
              </dt>
              <dd className="mt-0.5 text-body font-semibold tabular-nums">
                {formatAud(model.upcomingProceedsCents)}
              </dd>
              <p className="mt-0.5 text-body text-muted-foreground">
                Pending until the buyer accepts or inspection closes.
              </p>
            </div>
            {model.atRiskProceedsCents > 0 ? (
              <div>
                <dt className="text-meta uppercase tracking-wide text-muted-foreground">
                  Under dispute
                </dt>
                <dd className="mt-0.5 text-body font-semibold tabular-nums">
                  {formatAud(model.atRiskProceedsCents)}
                </dd>
                <p className="mt-0.5 text-body text-muted-foreground">
                  Counted in neither figure above while an outcome is owed. See
                  disputes below.
                </p>
              </div>
            ) : null}
          </dl>

          <p className="text-body text-muted-foreground">
            All figures are net of the 5% platform fee. Shipping is a pass-through.
          </p>

          {model.hasBlockedRelease ? (
            <p className="flex items-start gap-snug rounded-lg border border-destructive/40 bg-destructive/10 p-cozy text-body text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Part of this is blocked. The reason and what fixes it are listed
                below.
              </span>
            </p>
          ) : null}

        </CardContent>
      </Card>
    </section>
  );
}

function DestinationAccountSummary({
  destination,
  compact = false,
}: {
  destination: DestinationAccount;
  compact?: boolean;
}) {
  const copy = DESTINATION_COPY[destination.state];
  const needsSetup = destination.state !== 'VERIFIED';

  const card = (
    <Card className={compact ? 'h-full' : undefined}>
      <CardContent className="flex flex-col gap-cozy p-group sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-cozy">
          <span className="grid size-10 shrink-0 place-items-center rounded-md border bg-muted/30">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-snug">
              <p className="text-body font-semibold">
                {destination.verifiedName ?? 'Stripe payout account'}
              </p>
              <Badge variant={copy.variant}>{copy.badge}</Badge>
            </div>
            <p className="mt-0.5 text-body text-muted-foreground">
              {destination.state === 'VERIFIED'
                ? 'Bank account on file with Stripe · releases are automatic'
                : copy.detail}
            </p>
          </div>
        </div>
        {destination.hostedOnboarding ? (
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link href="/profile/payouts#payout-setup">
              {needsSetup ? 'Finish setup' : 'Manage with Stripe'}
              <ArrowUpRight aria-hidden />
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );

  if (compact) return card;

  return (
    <section aria-labelledby="destination-heading">
      <h3 id="destination-heading" className="mb-cozy text-meta font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Where your money goes
      </h3>
      {card}
      <p className="mt-snug text-body text-muted-foreground">
        Bank details are held by Stripe. NoDitto never receives or stores them.
      </p>
    </section>
  );
}

function ActiveSalesSummary({ model }: { model: PayoutReadModel }) {
  const hasActivity = model.releasing.length > 0 || model.upcomingProceedsCents > 0;

  return (
    <section aria-labelledby="active-sales-heading">
      <h3 id="active-sales-heading" className="mb-cozy text-meta font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Active sales
      </h3>
      {!hasActivity ? (
        <EmptyState
          title="No current activity"
          titleAs="h4"
          description="Once a buyer pays for one of your listings, its release status appears here."
          action={{ label: 'Create a listing', href: '/listings/new' }}
          className="border-solid bg-card"
          compact
        />
      ) : (
        <Card>
          <CardContent className="space-y-cozy pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-snug">
              <p className="text-body font-medium">Sales in progress</p>
              <p className="text-body font-semibold tabular-nums">
                {formatAud(model.upcomingProceedsCents + model.releasingNowCents)}
              </p>
            </div>
            {model.releasing.length > 0 ? (
              <ul className="divide-y rounded-md border">
                {model.releasing.map((sale) => (
                  <li key={sale.cashSaleId} className="flex items-center justify-between gap-cozy px-cozy py-snug">
                    <Link
                      href={`/sales/${sale.cashSaleId}`}
                      className="min-w-0 truncate text-body font-medium underline-offset-4 hover:underline"
                    >
                      {sale.itemTitle}
                    </Link>
                    <span className="shrink-0 text-body font-semibold tabular-nums">
                      {formatAud(sale.netCents)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">
                Buyer payment is pending while delivery and inspection are underway.
              </p>
            )}
          </CardContent>
        </Card>
      )}
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
      <h3 id="history-heading" className="mb-cozy text-meta font-semibold uppercase tracking-[0.12em] text-muted-foreground">
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
          className="border-solid bg-card py-8"
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
        <ol className="space-y-cozy">
          {shown.map((entry) => (
            <li key={entry.id} className="border-l-2 border-border pl-group">
              <p className="text-body">
                {historySentence(entry)}
                {entry.kind === 'SENT' ? (
                  <span className="font-medium">
                    {' '}
                    This can take up to four business days to appear in your account.
                  </span>
                ) : null}
              </p>
              {entry.kind === 'FAILED' && entry.failureCause ? (
                <p className="mt-0.5 text-body text-muted-foreground">
                  {FAILURE_COPY[entry.failureCause].summary}
                </p>
              ) : null}
              <div className="mt-0.5 flex flex-wrap items-center gap-snug">
                <span className="text-meta text-muted-foreground">
                  {formatRelativeTime(entry.occurredAt)}
                </span>
                {entry.cashSaleId ? (
                  <Link
                    href={`/sales/${entry.cashSaleId}`}
                    className="text-meta underline underline-offset-2 hover:text-foreground"
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
      <div className="mb-group flex flex-wrap items-center gap-snug">
        <h3 id="arbitration-heading" className="text-subhead font-semibold">
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
        <ul className="space-y-group">
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
                    <div className="flex flex-wrap items-center justify-between gap-snug">
                      <div className="flex flex-wrap items-center gap-snug">
                        <Scale className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <CardTitle className="text-lead">
                          {ARBITRATION_LABEL[record.kind]}
                        </CardTitle>
                        <Badge variant={record.open ? 'destructive' : 'secondary'}>
                          {record.open ? 'Open' : 'Closed'}
                        </Badge>
                      </div>
                      <span className="shrink-0 text-body font-semibold tabular-nums">
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
                  <CardContent className="space-y-snug">
                    {record.reason ? (
                      <p className="whitespace-pre-line break-words rounded-md border bg-muted/40 p-snug text-meta">
                        {record.reason}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-snug">
                      {record.occurredAt ? (
                        <span className="text-meta text-muted-foreground">
                          {formatRelativeTime(record.occurredAt)}
                        </span>
                      ) : null}
                      {href ? (
                        <Link
                          href={href}
                          className="text-meta underline underline-offset-2 hover:text-foreground"
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
        <p className="mt-cozy text-body text-muted-foreground">
          An amount at risk appears in neither &ldquo;Releasing now&rdquo; nor
          &ldquo;Upcoming&rdquo; while an outcome is owed.
        </p>
      ) : null}
    </section>
  );
}
