// app/admin/page.tsx
//
// The admin / moderation console (Phase 6). A Server Component that:
//
//   1. Gates access server-side. Unauthenticated visitors are redirected to
//      sign-in; authenticated non-admins get a "Not authorized" page that leaks
//      no data. Admin status is read from the caller's OWN profile via the
//      cookie-bound client (RLS scopes it to `auth.uid()`).
//   2. Reads console data with the SERVICE-ROLE admin client, because admins are
//      not row-parties for other users' reports/items/trades and need cross-user
//      visibility to triage. The service-role client is server-only and never
//      reaches the browser.
//
// Two stacked sections: Open Reports (triage) and Flagged trades (manual
// reconciliation review). Per-row moderation is driven by small client islands
// under components/admin/*, which call admin-gated server actions.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatRelativeTime } from '@/lib/format';
import { ReportActions } from '@/components/admin/ReportActions';
import { ClearFlagButton } from '@/components/admin/ClearFlagButton';
import { PageShell } from '@/components/layout/PageShell';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { Badge } from '@/components/ui/badge';
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
  title: 'Admin · Poke-xchange',
};

// Reads the caller's session + live moderation data - never prerender.
export const dynamic = 'force-dynamic';

type ReportRow = Tables<'reports'>;
type TradeRow = Tables<'trades'>;

/** Map a report status to a Badge variant. */
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  OPEN: 'default',
  ACTIONED: 'secondary',
  DISMISSED: 'outline',
};

/** Render the 403-style "Not authorized" page without leaking any data. */
function NotAuthorized() {
  return (
    <PageShell width="form" centered>
      <EmptyState
        icon={<ShieldAlert className="size-6" aria-hidden />}
        title="Not authorized"
        titleAs="h1"
        description="You don't have permission to view the moderation console."
        action={{ label: 'Return home', href: '/', variant: 'outline' }}
      />
    </PageShell>
  );
}

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauthenticated → sign-in with a return path.
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

  // Confirmed admin: use the service-role client for cross-user reads.
  const admin = createAdminClient();

  const [{ data: reportsData }, { data: tradesData }] = await Promise.all([
    admin
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false }),
    admin
      .from('trades')
      .select('*')
      .eq('manual_reconciliation', true)
      .order('created_at', { ascending: false }),
  ]);

  // Sort OPEN reports to the top, keeping newest-first within each group.
  const reports = ([...((reportsData ?? []) as ReportRow[])]).sort((a, b) => {
    const aOpen = a.status === 'OPEN' ? 0 : 1;
    const bOpen = b.status === 'OPEN' ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return b.created_at.localeCompare(a.created_at);
  });
  const trades = (tradesData ?? []) as TradeRow[];

  // Enrich reporters + user targets with display names for readability. Also
  // resolve every trade participant so the flagged-trades list never shows a
  // raw UUID (demo-contract-ux Task 7.2): admins still need to trace exact
  // records, so full ids remain available via the "View trade" link, but the
  // at-a-glance summary reads by name.
  const profileIds = new Set<string>();
  for (const r of reports) {
    profileIds.add(r.reporter_id);
    if (r.target_type === 'user') profileIds.add(r.target_id);
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

  const openCount = reports.filter((r) => r.status === 'OPEN').length;

  return (
    <MarketplaceShell title="Admin" contentWidth="detail">
      <header className="mb-8 border-b border-border/70 pb-5">
        <h2 className="text-balance text-2xl font-bold tracking-[-0.035em] sm:text-3xl">
          Moderation console
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Triage community reports and review flagged trades.
        </p>
      </header>

      {/* Open reports */}
      <section aria-labelledby="reports-heading" className="mb-12">
        <div className="mb-4 flex items-center gap-2">
          <h2 id="reports-heading" className="text-xl font-semibold">
            Reports
          </h2>
          {openCount > 0 && <Badge>{openCount} open</Badge>}
        </div>

        {reports.length === 0 ? (
          <EmptyState
            title="No reports"
            titleAs="h3"
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
                report.target_type === 'item' ? 'View listing' : nameFor(report.target_id);
              const reporterName = nameFor(report.reporter_id);

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
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(report.created_at)}
                        </span>
                      </div>
                      <CardDescription>
                        Reported by {reporterName} ·{' '}
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
                        <p className="whitespace-pre-line text-sm text-foreground">
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

      {/* Flagged trades */}
      <section aria-labelledby="trades-heading">
        <div className="mb-4 flex items-center gap-2">
          <h2 id="trades-heading" className="text-xl font-semibold">
            Flagged trades
          </h2>
          {trades.length > 0 && <Badge variant="secondary">{trades.length}</Badge>}
        </div>

        {trades.length === 0 ? (
          <EmptyState
            title="No flagged trades"
            titleAs="h3"
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
                      <span className="text-xs text-muted-foreground">
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
                        <dt className="inline font-medium text-foreground">Counterpart: </dt>
                        <dd className="inline">{nameFor(trade.counterpart_id)}</dd>
                      </div>
                      {trade.fraud_victim_id ? (
                        <div>
                          <dt className="inline font-medium text-foreground">Fraud victim: </dt>
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
    </MarketplaceShell>
  );
}
