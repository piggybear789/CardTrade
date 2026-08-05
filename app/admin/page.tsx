// app/admin/page.tsx
//
// The operations console. One tab per queue, admin-gated.
//
// WHAT THIS PAGE IS FOR, AND WHAT IT IS NOT.
//
// There are two operator surfaces, and the line between them is one question: is
// someone waiting on your JUDGEMENT, or is the system waiting on your ATTENTION?
//
//   /admin/arbitration  judgement. Two members disagree, money is frozen, and only a
//                       human can decide who gets it. Deciding moves money.
//   /admin (here)       attention. A report to action, a payout to unblock, a
//                       reconciliation flag to clear. The platform handles these on its
//                       own; you are unsticking them.
//
// THIS PAGE USED TO BREAK THAT RULE. It listed disputed sales, disputed trades, disputed
// deals and chargebacks â€” all four record types the arbitration workspace owns â€” so the
// same records appeared on two surfaces with different controls. That is not a
// distinction anyone could infer, because there wasn't one. Those sections are gone;
// what remains is what this page uniquely owns.
//
// WHY TABS AND NOT ONE TABLE. The three queues share almost no columns: a report has no
// counterparty and no money, a payout has no claimant, a reconciliation flag has neither
// a reason nor an amount. A single table over all three is mostly empty cells, and the
// per-row action differs every time. Tabs also let the page fetch only the rows it is
// about to show â€” it previously ran seven full table reads on every visit regardless.
//
// Authorization: the caller's own `is_admin` via the cookie-bound client (RLS scopes it
// to `auth.uid()`), then the SERVICE-ROLE client for cross-user reads, because an admin
// is not a row-party to other members' reports, sales or trades. Every mutating control
// is a small client island under `components/admin/*` calling an admin-gated action.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Scale, ShieldAlert } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatAud, formatRelativeTime } from '@/lib/format';
import { getCustodyPosition, type CustodyReport } from '@/lib/actions/admin';
import { ReportActions } from '@/components/admin/ReportActions';
import { ClearFlagButton } from '@/components/admin/ClearFlagButton';
import { CustodyPanel } from '@/components/admin/CustodyPanel';
import { DrainPayoutsButton, RetryPayoutButton } from '@/components/admin/PayoutActions';
import { PageShell } from '@/components/layout/PageShell';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionHeader } from '@/components/layout/SectionHeader';
import { SectionTabs } from '@/components/layout/SectionFilter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { Tables } from '@/lib/supabase/database.types';

export const metadata = {
  title: 'Operations Â· NoDitto',
};

// Reads the caller's session + live queue state â€” never prerender.
export const dynamic = 'force-dynamic';

type ReportRow = Tables<'reports'>;
type TradeRow = Tables<'trades'>;
type CashSaleRow = Tables<'cash_sales'>;

/** Which queue the operator is looking at. */
type ConsoleTab = 'payouts' | 'reports' | 'reconciliation';

/**
 * Narrow an arbitrary `?tab=` value.
 *
 * Defaults to Payouts, not Reports: it is the only queue holding money that belongs to
 * somebody else, so it is the one whose backlog costs trust rather than tidiness.
 */
function resolveConsoleTab(value: string | string[] | undefined): ConsoleTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'reports' || raw === 'reconciliation' ? raw : 'payouts';
}

/** Map a report status to a Badge variant. */
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  OPEN: 'default',
  ACTIONED: 'secondary',
  DISMISSED: 'outline',
};

/** Render the 403-style "Not authorized" page without leaking any data. */
function NotAuthorized() {
  return (
    <PageShell centered>
      <EmptyState
        icon={<ShieldAlert className="size-6" aria-hidden />}
        title="Not Authorized"
        titleAs="h1"
        description="You don't have permission to view the operations console."
        action={{ label: 'Return home', href: '/', variant: 'outline' }}
        className="border-none"
      />
    </PageShell>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab = resolveConsoleTab(rawTab);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in?redirectTo=/admin');
  }

  // Authorization: read the caller's OWN profile (RLS-scoped) for is_admin.
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
    return <NotAuthorized />;
  }

  const admin = createAdminClient();

  // Tab badges and the arbitration hand-off need counts, not rows. `head: true` asks
  // Postgres for the count alone, so the six queues this page does NOT currently show
  // cost a count each instead of a full table read.
  const [
    reportCount,
    payoutCount,
    reconciliationCount,
    disputedSaleCount,
    disputedTradeCount,
    openChargebackCount,
  ] = await Promise.all([
    admin
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'OPEN'),
    admin
      .from('cash_sales')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'COMPLETED')
      .in('seller_payout_status', ['PENDING', 'FAILED']),
    admin
      .from('trades')
      .select('id', { count: 'exact', head: true })
      .eq('manual_reconciliation', true),
    admin
      .from('cash_sales')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'DISPUTED'),
    admin
      .from('trades')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'DISPUTED'),
    admin
      .from('charge_disputes')
      .select('id', { count: 'exact', head: true })
      .is('closed_at', null),
  ]);

  const openReports = reportCount.count ?? 0;
  const owedReleases = payoutCount.count ?? 0;
  const flaggedTrades = reconciliationCount.count ?? 0;
  // Everything waiting on a human decision, across all four case kinds. Shown here as a
  // single number with a link out, rather than as four duplicated lists.
  const openCases =
    (disputedSaleCount.count ?? 0) +
    (disputedTradeCount.count ?? 0) +
    (openChargebackCount.count ?? 0);

  // Only the visible tab's rows are read.
  let reports: ReportRow[] = [];
  let owedPayouts: CashSaleRow[] = [];
  let trades: TradeRow[] = [];
  let custody: CustodyReport | null = null;

  if (tab === 'reports') {
    const { data } = await admin
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });
    // OPEN to the top, newest-first within each group.
    reports = [...((data ?? []) as ReportRow[])].sort((a, b) => {
      const aOpen = a.status === 'OPEN' ? 0 : 1;
      const bOpen = b.status === 'OPEN' ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return b.created_at.localeCompare(a.created_at);
    });
  } else if (tab === 'payouts') {
    // Oldest due first: that is the seller who has been waiting longest.
    const [{ data }, position] = await Promise.all([
      admin
        .from('cash_sales')
        .select('*')
        .eq('status', 'COMPLETED')
        .in('seller_payout_status', ['PENDING', 'FAILED'])
        .order('seller_payout_due_at', { ascending: true, nullsFirst: true }),
      // Only on this tab: it calls the provider, so it should not cost anything on the
      // Reports or Reconciliation views.
      getCustodyPosition(),
    ]);
    owedPayouts = (data ?? []) as CashSaleRow[];
    custody = position.ok ? position.data : null;
  } else {
    const { data } = await admin
      .from('trades')
      .select('*')
      .eq('manual_reconciliation', true)
      .order('created_at', { ascending: false });
    trades = (data ?? []) as TradeRow[];
  }

  // Resolve display names for the rows actually on screen, so no list shows a raw UUID.
  // Exact ids stay reachable through each row's "View" link.
  const profileIds = new Set<string>();
  for (const r of reports) {
    profileIds.add(r.reporter_id);
    if (r.target_type === 'user') profileIds.add(r.target_id);
  }
  for (const s of owedPayouts) {
    profileIds.add(s.seller_id);
    profileIds.add(s.buyer_id);
  }
  for (const t of trades) {
    profileIds.add(t.initiator_id);
    profileIds.add(t.counterpart_id);
    if (t.fraud_victim_id) profileIds.add(t.fraud_victim_id);
  }
  const nameById = new Map<string, string>();
  if (profileIds.size > 0) {
    const { data: names } = await admin
      .from('profiles')
      .select('id, display_name')
      .in('id', Array.from(profileIds));
    for (const n of names ?? []) {
      nameById.set(n.id as string, (n.display_name as string | null) ?? 'Unknown');
    }
  }
  const nameFor = (id: string) => nameById.get(id) ?? 'Unknown member';

  const owedCents = owedPayouts.reduce(
    (sum, sale) => sum + Math.max(sale.amount_cents - sale.platform_fee_cents, 0),
    0,
  );

  return (
    <MarketplaceShell title="Operations">
      <SectionHeader
        title="Operations"
        description="Queues the platform runs itself, plus community reports. Disputes that need a decision from you live in Cases."
        actions={
          <Button asChild variant={openCases > 0 ? 'default' : 'outline'}>
            <Link href="/admin/arbitration">
              <Scale aria-hidden />
              {openCases > 0 ? `${openCases} case${openCases === 1 ? '' : 's'}` : 'Cases'}
            </Link>
          </Button>
        }
      />

      <SectionTabs
        label="Operations queues"
        currentKey={tab}
        tabs={[
          { key: 'payouts', label: 'Payouts', count: owedReleases, href: '/admin?tab=payouts' },
          { key: 'reports', label: 'Reports', count: openReports, href: '/admin?tab=reports' },
          {
            key: 'reconciliation',
            label: 'Reconciliation',
            count: flaggedTrades,
            href: '/admin?tab=reconciliation',
          },
        ]}
      />

      {tab === 'payouts' ? (
        <section aria-labelledby="payouts-heading">
          {/* Leads the tab: everything below it is what we believe we owe, and this is
              the only figure that can contradict that belief. */}
          {custody ? <CustodyPanel position={custody} /> : null}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="payouts-heading" className="text-xl font-semibold">
                Seller releases owed
              </h3>
              {owedPayouts.length > 0 && (
                <Badge variant="destructive">
                  {formatAud(owedCents)} across {owedPayouts.length}
                </Badge>
              )}
            </div>
            {owedPayouts.length > 0 && <DrainPayoutsButton />}
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            Money the platform is holding that already belongs to a seller â€” the owner is
            settled and only the transfer is outstanding. An hourly job drains this on its
            own; anything sitting here is stuck.
          </p>

          {owedPayouts.length === 0 ? (
            <EmptyState
              title="Nothing Owed"
              titleAs="h4"
              description="Every completed sale has been released to its seller."
              compact
            />
          ) : (
            <ul className="space-y-4">
              {owedPayouts.map((sale) => {
                const net = Math.max(sale.amount_cents - sale.platform_fee_cents, 0);
                const failed = sale.seller_payout_status === 'FAILED';
                return (
                  <li key={sale.id}>
                    <Card>
                      <CardHeader>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={failed ? 'destructive' : 'secondary'}>
                              {sale.seller_payout_status}
                            </Badge>
                            <CardTitle className="text-base">
                              {formatAud(net)} to {nameFor(sale.seller_id)}
                            </CardTitle>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            completed {formatRelativeTime(sale.completed_at)}
                          </span>
                        </div>
                        <CardDescription className="break-words">
                          {sale.item_title} Â· paid by {nameFor(sale.buyer_id)} Â·{' '}
                          <Link
                            href={`/sales/${sale.id}`}
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            View sale
                          </Link>
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <dl className="grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                          <div>
                            <dt className="inline font-medium text-foreground">Attempts: </dt>
                            <dd className="inline">{sale.seller_payout_attempts}</dd>
                          </div>
                          <div>
                            <dt className="inline font-medium text-foreground">
                              Platform fee kept:{' '}
                            </dt>
                            <dd className="inline">{formatAud(sale.platform_fee_cents)}</dd>
                          </div>
                          {sale.seller_payout_error ? (
                            <div className="sm:col-span-2">
                              <dt className="inline font-medium text-foreground">
                                Last error:{' '}
                              </dt>
                              <dd className="inline break-words">
                                {sale.seller_payout_error}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                        <RetryPayoutButton cashSaleId={sale.id} />
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'reports' ? (
        <section aria-labelledby="reports-heading">
          <div className="mb-4 flex items-center gap-2">
            <h3 id="reports-heading" className="text-xl font-semibold">
              Community reports
            </h3>
            {openReports > 0 && <Badge>{openReports} open</Badge>}
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            Members reporting a listing or another member. Actioning one hides content or
            flags an account; it never moves money.
          </p>

          {reports.length === 0 ? (
            <EmptyState
              title="No Reports"
              titleAs="h4"
              description="No reports have been submitted."
              compact
            />
          ) : (
            <ul className="space-y-4">
              {reports.map((report) => {
                const targetHref =
                  report.target_type === 'item'
                    ? `/listings/${report.target_id}`
                    : `/sellers/${report.target_id}`;
                const targetLabel =
                  report.target_type === 'item'
                    ? 'View listing'
                    : nameFor(report.target_id);

                return (
                  <li key={report.id}>
                    <Card>
                      <CardHeader>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="capitalize">
                              {report.target_type}
                            </Badge>
                            <Badge variant={STATUS_VARIANT[report.status] ?? 'default'}>
                              {report.status}
                            </Badge>
                            <CardTitle className="text-base">{report.reason}</CardTitle>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatRelativeTime(report.created_at)}
                          </span>
                        </div>
                        <CardDescription className="break-words">
                          Reported by {nameFor(report.reporter_id)} Â·{' '}
                          <Link
                            href={targetHref}
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            {targetLabel}
                          </Link>
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {report.details ? (
                          <p className="whitespace-pre-line break-words text-sm text-foreground">
                            {report.details}
                          </p>
                        ) : (
                          <p className="text-sm italic text-muted-foreground">
                            No additional details provided.
                          </p>
                        )}

                        {report.status === 'OPEN' ? (
                          <ReportActions
                            reportId={report.id}
                            targetType={report.target_type as 'item' | 'user'}
                            targetId={report.target_id}
                          />
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Reviewed {formatRelativeTime(report.reviewed_at)}.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'reconciliation' ? (
        <section aria-labelledby="trades-heading">
          <div className="mb-4 flex items-center gap-2">
            <h3 id="trades-heading" className="text-xl font-semibold">
              Flagged trades
            </h3>
            {flaggedTrades > 0 && <Badge variant="secondary">{flaggedTrades}</Badge>}
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            Trades where a capture or release exhausted its automatic retries, so the
            provider and our records may disagree. Reconcile in the Stripe dashboard, then
            clear the flag.
          </p>

          {trades.length === 0 ? (
            <EmptyState
              title="No Flagged Trades"
              titleAs="h4"
              description="No trades need manual reconciliation."
              compact
            />
          ) : (
            <ul className="space-y-4">
              {trades.map((trade) => (
                <li key={trade.id}>
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="destructive">Manual reconciliation</Badge>
                          <Badge variant="outline">{trade.state}</Badge>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatRelativeTime(trade.created_at)}
                        </span>
                      </div>
                      <CardDescription>
                        <Link
                          href={`/trades/${trade.id}`}
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          View trade
                        </Link>
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <dl className="grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                        <div>
                          <dt className="inline font-medium text-foreground">Initiator: </dt>
                          <dd className="inline">{nameFor(trade.initiator_id)}</dd>
                        </div>
                        <div>
                          <dt className="inline font-medium text-foreground">
                            Counterpart:{' '}
                          </dt>
                          <dd className="inline">{nameFor(trade.counterpart_id)}</dd>
                        </div>
                        {trade.fraud_victim_id ? (
                          <div>
                            <dt className="inline font-medium text-foreground">
                              Fraud victim:{' '}
                            </dt>
                            <dd className="inline">{nameFor(trade.fraud_victim_id)}</dd>
                          </div>
                        ) : null}
                      </dl>
                      <ClearFlagButton tradeId={trade.id} />
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </MarketplaceShell>
  );
}
