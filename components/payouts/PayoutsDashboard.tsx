// components/payouts/PayoutsDashboard.tsx
//
// The member-facing Payouts_Dashboard (Req 3, 4, 5, 6, 7, 10, 11).
//
// A Server Component: every figure is derived on the server by
// `getPayoutsDashboard`, so nothing here recomputes money from partial data. The
// only interactive part is the payout-setup link, which is an ordinary anchor.
//
// THREE SECTIONS IN A FIXED ORDER after the page-level tiles (Req 1.5): active
// sales, where money is going, transfer history, then arbitration when present.
// Headline balances live in the profile tiles so they are not repeated here.
//
// WORDING IS LOAD-BEARING. The reference dashboard this is modelled on labels its
// headline "Available Now", which implies a withdraw button. CardTrade has no
// per-member provider balance and no withdrawal endpoint — a release is queued
// automatically and drained by an hourly job — so the headline is "Releasing now"
// and there is deliberately no cash-out control anywhere on this page (Req 1.8).
// Likewise a settled release is described as SENT, never as arrived or received:
// once the provider has it, the timing belongs to the bank.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlertCircleIcon,
  ArrowUpRight01Icon,
  ScaleIcon,
  ShieldCheckIcon,
} from '@hugeicons/core-free-icons';

import type {
  ArbitrationRecord,
  PayoutReadModel,
  ReleaseFailureCause,
  TransferHistoryEntry,
} from '@/domain/payouts/payoutReadModel';
import type { DestinationAccount } from '@/lib/actions/payouts';
import type { AccountStatement as AccountStatementModel } from '@/domain/statement/accountStatement';
import { AccountStatement } from '@/components/payouts/AccountStatement';
import { formatAud, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
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
    href: '/profile?tab=payouts',
    actionLabel: 'Open Stripe Connect setup',
  },
  PROVIDER_REJECTED: {
    summary: 'Our payment provider rejected this release.',
    action: 'We are retrying it automatically. Nothing is needed from you.',
  },
  RETRIES_EXHAUSTED: {
    summary: 'Automatic retries for this release have stopped.',
    action: 'A NoDitto operator is reviewing it. Your funds are safe and release will be retried.',
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
  /**
   * The full Account_Statement — both directions — rendered as the table at the
   * foot of the tab. Null when it could not be read; the seller-side sections
   * above still render from `model`, and the table falls back to the old
   * seller-only transfer history so the tab never loses its ledger entirely.
   */
  statement: AccountStatementModel | null;
  /** Which slice of the statement / history to show. URL-driven via `?show=`. */
  scope: SectionScope;
}

/**
 * Section heading for the dashboard.
 *
 * Sentence case at body size, matching `SettingsGroup`'s labels on the tabs either
 * side of this one. These were hardcoded 11px uppercase on wide tracking, so the
 * Payouts tab carried two heading vocabularies at once: sentence case above the fold
 * and eyebrows below it.
 */
function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="mb-snug px-tight text-body font-medium text-muted-foreground">
      {children}
    </h3>
  );
}

export function PayoutsDashboard({ model, destination, statement, scope }: PayoutsDashboardProps) {
  // NOTHING HAS EVER HAPPENED HERE, so say it once.
  //
  // Each section owned its own empty state, so a seller who had not sold anything yet
  // met three headings and three paragraphs that all said the same thing in different
  // words — "Active sales / No current activity / Once a buyer pays for one of your
  // listings…", then the same shape again for history, then again for disputes. Six
  // blocks of prose to report that nothing has happened is the reason this tab read as
  // dense and confusing. One state, one sentence, one thing to do.
  //
  // "Nothing" now means nothing in EITHER direction: a member who has only ever
  // bought has a statement, so the empty state must not claim otherwise.
  const nothingYet =
    model.releasing.length === 0 &&
    model.history.length === 0 &&
    model.arbitrations.length === 0 &&
    model.upcomingProceedsCents === 0 &&
    model.releasingNowCents === 0 &&
    model.atRiskProceedsCents === 0 &&
    (statement == null || statement.entries.length === 0);

  if (nothingYet) {
    return (
      <div className="space-y-group font-sans">
        {destination.state === 'VERIFIED' ? (
          <DestinationAccountSummary destination={destination} />
        ) : null}
        <EmptyState
          title="Nothing has moved yet"
          titleAs="h3"
          description="Purchases, sales, trade fees and collateral will appear here as they happen."
          action={{ label: 'Browse listings', href: '/' }}
          // Matches the other section empty states here. `EmptyState` deliberately
          // drops its card chrome below `md` so a section state sits where the first
          // row would; only the desktop dashed border is overridden to solid.
          className="border-solid bg-card"
          compact
        />
      </div>
    );
  }

  return (
    <div className="space-y-section font-sans">
      <BlockedReleaseBanner model={model} />
      <ActiveSalesSummary model={model} />
      {/* ONE payout destination card, not two.

          The standalone destination section earns its place only once VERIFIED,
          because that is the only state where it reports something the setup flow on
          the Verification tab cannot: `verifiedName`, the actual account the money
          lands in. Before then "where your money goes" has no answer. */}
      {destination.state === 'VERIFIED' ? (
        <DestinationAccountSummary destination={destination} />
      ) : null}
      {/* THE STATEMENT REPLACES TRANSFER HISTORY AND ARBITRATION. Both were slices
          of the same ledger — money sent to you, money captured from you — shown as
          two prose lists three sections apart. One table, both directions, with
          purchases and trade fees that had never appeared anywhere. The old sections
          remain only as the fallback for a statement read failure. */}
      {statement ? (
        <AccountStatement statement={statement} scope={scope} />
      ) : (
        <>
          <TransferHistory model={model} scope={scope} />
          {model.arbitrations.length > 0 || model.atRiskProceedsCents > 0 ? (
            <ArbitrationSummary model={model} />
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The one thing on this page that may need the Member to act.
 *
 * IT NAMES THE AMOUNT, and that is the whole point of adding it. A blocked release was
 * reported in two places, neither of which said how much: the summary caption read
 * "Part of this is held up", and the failure sentence sat on individual entries part-way
 * down the transfer list, where a seller had to open Active and read four rows to
 * discover that $240 of their money was stuck behind an unfinished Connect setup.
 *
 * ONE BANNER FOR ALL BLOCKED RELEASES, not one per sale. The causes are few and the
 * remedy is per-cause rather than per-sale — finishing payout setup unblocks every
 * NOT_PAYABLE release at once — so the banner leads with the total and states the
 * remedy for the cause that is actually holding the largest share.
 *
 * `destructive` tone rather than a neutral note: money the platform has collected and
 * cannot pass on is the most serious thing this page can report.
 */
function BlockedReleaseBanner({ model }: { model: PayoutReadModel }) {
  if (!model.hasBlockedRelease) return null;

  // The cause behind the most money, so a member with two blocked sales for different
  // reasons is told to do the thing that frees the larger amount first.
  const byCause = new Map<ReleaseFailureCause, number>();
  for (const sale of model.releasing) {
    if (!sale.blocked || !sale.failureCause) continue;
    byCause.set(
      sale.failureCause,
      (byCause.get(sale.failureCause) ?? 0) + sale.netCents,
    );
  }
  const leading = [...byCause.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const copy = leading ? FAILURE_COPY[leading] : null;
  const otherCauses = byCause.size - 1;

  return (
    <section
      aria-labelledby="blocked-release-heading"
      className="rounded-lg border border-destructive/40 bg-destructive/[0.05] p-group"
    >
      <div className="flex items-start gap-cozy">
        <HugeiconsIcon
          icon={AlertCircleIcon}
          className="mt-0.5 size-5 shrink-0 text-destructive"
          aria-hidden
        />
        <div className="min-w-0 space-y-tight">
          <h3
            id="blocked-release-heading"
            className="text-body font-semibold text-destructive"
          >
            {formatAud(model.blockedReleaseCents)} could not be sent yet
          </h3>
          {copy ? (
            <p className="text-body">
              {copy.summary} {copy.action}
            </p>
          ) : null}
          {otherCauses > 0 ? (
            // Named rather than folded in silently: fixing the leading cause will not
            // clear the banner, and a member who does the thing it asked and sees the
            // warning persist has been told something untrue by omission.
            <p className="text-meta text-muted-foreground">
              {otherCauses === 1
                ? 'One other release is held up for a different reason. See the transfer history below.'
                : `${otherCauses} other releases are held up for different reasons. See the transfer history below.`}
            </p>
          ) : null}
          <p className="text-meta text-muted-foreground">
            Nothing is lost. Blocked releases are retried automatically once the cause
            clears.
          </p>
          {copy?.href && copy.actionLabel ? (
            <Button asChild size="sm" className="mt-snug">
              <Link href={copy.href}>{copy.actionLabel}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </section>
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
          <span className="grid size-10 shrink-0 place-items-center rounded-md border bg-muted">
            <HugeiconsIcon icon={ShieldCheckIcon} className="size-4 text-muted-foreground" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-snug">
              <p className="text-body font-semibold">
                {destination.verifiedName ?? 'Stripe payout account'}
              </p>
              <Badge variant={copy.variant}>{copy.badge}</Badge>
            </div>
            {/* "· releases are automatic" dropped: the summary block directly above
                this already says "Released automatically" under the figure it
                describes. */}
            <p className="mt-0.5 text-body text-muted-foreground">
              {destination.state === 'VERIFIED'
                ? 'Bank account on file with Stripe'
                : copy.detail}
            </p>
          </div>
        </div>
        {destination.hostedOnboarding ? (
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link href="/profile?tab=payouts#payout-setup">
              {needsSetup ? 'Finish setup' : 'Manage with Stripe'}
              <HugeiconsIcon icon={ArrowUpRight01Icon} aria-hidden />
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );

  if (compact) return card;

  return (
    <section aria-labelledby="destination-heading">
      <SectionHeading id="destination-heading">Where your money goes</SectionHeading>
      {card}
      {/* No custody footnote here any more. It read "Bank details are held by Stripe.
          NoDitto never receives or stores them." directly under a card whose own
          subtitle already says "Bank account on file with Stripe", on a page whose
          header now states "ID checked by Stripe · Payouts active". Three statements
          of one fact within a screen of each other. */}
    </section>
  );
}

/**
 * THE ONE COLUMN DEFINITION for the releasing list. Header and rows both apply it.
 *
 * Two columns below `sm` — the sale and what lands — because price and fee will not fit
 * beside a title at 320px without truncating it. They fold into a sub-line at that
 * width, and the two middle cells are `hidden`, which removes them from grid flow so
 * the template matches the number of visible cells.
 */
const RELEASE_ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-cozy ' +
  'sm:grid-cols-[minmax(0,1fr)_6rem_5rem_6rem]';

function ActiveSalesSummary({ model }: { model: PayoutReadModel }) {
  const hasActivity = model.releasing.length > 0 || model.upcomingProceedsCents > 0;

  return (
    <section aria-labelledby="active-sales-heading">
      <SectionHeading id="active-sales-heading">Active sales</SectionHeading>
      {!hasActivity ? (
        // Reached only when something else on the tab has activity — the all-empty
        // case is short-circuited above — so this is a one-line absence, not a
        // first-run explainer.
        <EmptyState
          title="Nothing in progress"
          titleAs="h4"
          description="No sale is currently awaiting delivery or inspection."
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
              // SHOWS THE ARITHMETIC, not just the answer. This listed net alone, so a
              // seller who agreed $120 saw $114 with no account of the difference and
              // no way to tell a fee from a partial refund — and those two have very
              // different implications. Three columns on one grid, declared once, so
              // the figures line up down the list rather than per row.
              <div className="overflow-hidden rounded-md border">
                <div
                  className={cn(
                    RELEASE_ROW_GRID,
                    'hidden border-b bg-muted px-cozy py-tight sm:grid',
                  )}
                  aria-hidden="true"
                >
                  <span className="market-label text-muted-foreground">Sale</span>
                  {/* "BUYER PAID", NOT "PRICE". `grossCents` is `amount_cents`, which is
                      the agreed price PLUS the platform fee PLUS shipping — what the
                      buyer was charged. Labelling it Price stated the wrong number
                      under the right word: a $56.00 card read as a $58.80 price, and
                      the seller's own agreed figure appeared nowhere in the row. */}
                  <span className="market-label text-right text-muted-foreground">Buyer paid</span>
                  <span className="market-label text-right text-muted-foreground">Fee</span>
                  <span className="market-label text-right text-muted-foreground">You get</span>
                </div>
                <ul className="divide-y">
                  {model.releasing.map((sale) => (
                    <li
                      key={sale.cashSaleId}
                      className={cn(RELEASE_ROW_GRID, 'items-baseline px-cozy py-snug')}
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/sales/${sale.cashSaleId}`}
                          transitionTypes={['nav-forward']}
                          className="block truncate text-body font-medium underline-offset-4 hover:underline"
                        >
                          {sale.itemTitle}
                        </Link>
                        {/* Below `sm` the two middle columns are gone, so the gross and
                            fee fold into one line here — the seller still gets the
                            arithmetic, just as a sentence rather than a table. */}
                        <p className="text-meta tabular-nums text-muted-foreground sm:hidden">
                          Buyer paid {formatAud(sale.grossCents)}, less{' '}
                          {formatAud(sale.feeCents)} fee
                        </p>
                        {sale.blocked ? (
                          <p className="text-meta text-destructive">Held up</p>
                        ) : null}
                      </div>
                      <span className="hidden text-right text-body tabular-nums text-muted-foreground sm:block">
                        {formatAud(sale.grossCents)}
                      </span>
                      <span className="hidden text-right text-body tabular-nums text-muted-foreground sm:block">
                        −{formatAud(sale.feeCents)}
                      </span>
                      <span className="text-right text-body font-semibold tabular-nums">
                        {formatAud(sale.netCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
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
      <SectionHeading id="history-heading">Transfer history</SectionHeading>

      {model.history.length > 0 ? (
        <SectionFilter
          scope={scope}
          basePath="/profile?tab=payouts"
          activeCount={active.length}
          pastCount={past.length}
        />
      ) : null}

      {model.history.length === 0 ? (
        // Sentence case, matching every other title on the surface. These were Title
        // Case ("Nothing Has Moved Yet"), which is a third capitalisation convention
        // on one tab.
        <EmptyState
          title="Nothing has moved yet"
          titleAs="h4"
          description="The first entry appears when a buyer accepts an item."
          className="border-solid bg-card py-section"
          compact
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title={scope === 'past' ? 'Nothing completed yet' : 'Nothing in progress'}
          titleAs="h4"
          description={
            scope === 'past'
              ? 'Anything still moving is under Active.'
              : 'Everything has finished. Completed transfers are under Past.'
          }
          compact
        />
      ) : (
        // THE SAME CONTAINER AS EVERY OTHER LIST ON THE SURFACE. Entries were bare
        // text hanging off a 2px left stripe — a fourth container style on a tab that
        // already had cards, groups and rows, and a decorative rule carrying no
        // meaning. They are rows in a group now, like the rest of Account.
        <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {shown.map((entry) => (
            <li key={entry.id} className="px-group py-cozy">
              <p className="text-body">{historySentence(entry)}</p>
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
                    transitionTypes={['nav-forward']}
                    className="text-body underline underline-offset-2 hover:text-foreground"
                  >
                    View sale
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* ONCE, UNDER THE LIST. This was appended in bold to the end of every SENT
          entry, so a seller with six completed transfers read the same sentence six
          times down the page. It is a property of bank transfers, not of any one
          entry. */}
      {shown.some((entry) => entry.kind === 'SENT') ? (
        <p className="mt-snug px-tight text-body text-muted-foreground">
          Sent transfers can take up to four business days to reach your bank.
        </p>
      ) : null}
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
        // THIS BRANCH ONLY RUNS WITH MONEY AT RISK, because the caller renders this
        // section on `arbitrations.length > 0 || atRiskProceedsCents > 0`. It used to
        // say "No Disputes — No disputes or fraud resolutions are affecting your
        // money" directly beside a badge reading "$X at risk", flatly contradicting
        // it. Say the true thing: there is money held, and the case is not yours.
        <EmptyState
          title="Held pending an outcome"
          titleAs="h4"
          description="A case involving one of your sales is open. Nothing is needed from you."
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
                  <CardHeader className="pb-cozy">
                    <div className="flex flex-wrap items-center justify-between gap-snug">
                      <div className="flex flex-wrap items-center gap-snug">
                        <HugeiconsIcon icon={ScaleIcon} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
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
                      <p className="whitespace-pre-line break-words rounded-md border bg-muted p-snug text-body">
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
                          className="text-body underline underline-offset-2 hover:text-foreground"
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

      {/* NAMES THE LABELS THAT ARE ACTUALLY ON SCREEN. This read "appears in neither
          'Releasing now' nor 'Upcoming'" — two headings the summary block above no
          longer uses, so it pointed at figures the member could not find. */}
      {model.atRiskProceedsCents > 0 ? (
        <p className="mt-cozy px-tight text-body text-muted-foreground">
          Money under dispute is counted here only — not in &ldquo;Owed to you&rdquo; or
          &ldquo;Held for open sales&rdquo; — until the outcome is decided.
        </p>
      ) : null}
    </section>
  );
}
