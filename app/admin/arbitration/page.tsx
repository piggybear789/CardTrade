// app/admin/arbitration/page.tsx
//
// The arbitration queue: every open case, triaged, for support staff.
//
// WHY IT IS NOT PART OF /admin. Dispute resolution had been bolted onto the admin
// console beside reports, owed releases, chargebacks and flagged trades. Two problems
// with that. It made deciding a dispute an act of scrolling — the context an arbitrator
// needs does not fit in a card. And it required full administrator rights to do a job
// that should not also carry the power to hide listings or drain payout queues.
//
// This surface is gated on `requireStaff` (is_support OR is_admin), so a support worker
// can arbitrate without being an admin. Every action re-checks that gate itself.
//
// Ordering is derived, never stored: `buildQueue` sorts by priority then age, and
// priority comes from hard deadlines, fraud allegations and SLA — deliberately not
// from amount, because weighting by money parks small disputes forever.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, Clock, Inbox, ShieldAlert, Wrench } from 'lucide-react';

import { getArbitrationQueue } from '@/lib/actions/arbitration';
import {
  ARBITRATION_SLA_HOURS,
  DEADLINE_WARNING_HOURS,
  filterQueue,
  resolveQueueScope,
  summariseQueue,
} from '@/domain/arbitration/arbitrationCase';
import {
  CASE_KIND_LABEL,
  PRIORITY_STYLE,
} from '@/components/arbitration/ArbitrationCaseView';
import { CaseAssignButton } from '@/components/arbitration/CaseAssignButton';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionHeader } from '@/components/layout/SectionHeader';
import { SectionTabs } from '@/components/layout/SectionFilter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAud, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Cases · NoDitto',
};

// Reads live case state and the caller's staff capability — never prerender.
export const dynamic = 'force-dynamic';

// Priority badges and kind labels are shared with the case page rather than declared
// twice, so a queue row and the case it opens can never disagree about what a case is
// or how urgent it looks.

export default async function ArbitrationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string | string[] }>;
}) {
  const { queue: rawScope } = await searchParams;
  const scope = resolveQueueScope(rawScope);

  const result = await getArbitrationQueue();

  if (!result.ok) {
    if (result.error === 'not-authenticated') {
      redirect('/sign-in?redirectTo=/admin/arbitration');
    }
    // A non-staff member gets a refusal that leaks no case data at all.
    return (
      <MarketplaceShell title="Cases" center>
        <EmptyState
          icon={<ShieldAlert className="size-6" aria-hidden />}
          title="Not Authorized"
          titleAs="h3"
          description="Cases are limited to CardTrade support staff."
          action={{ label: 'Return home', href: '/', variant: 'outline' }}
          className="border-none"
        />
      </MarketplaceShell>
    );
  }

  const { cases, viewerId, viewerIsAdmin } = result.data;
  const summary = summariseQueue(cases);
  const shown = filterQueue(cases, scope, viewerId);

  return (
    <MarketplaceShell title="Cases">
      <SectionHeader
        title="Cases"
        description="Disputes where two members disagree and money is frozen, so only a person can decide who gets it. Ordered by urgency, then by how long someone has been waiting."
        actions={
          viewerIsAdmin ? (
            <Button asChild variant="outline">
              <Link href="/admin">
                <Wrench aria-hidden />
                Operations
              </Link>
            </Button>
          ) : undefined
        }
      />

      {/* The headline numbers an arbitrator triages on. Money is shown but is
          deliberately not what drives the ordering. */}
      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Open cases', value: String(summary.total) },
          { label: 'Critical', value: String(summary.critical) },
          { label: `Over ${ARBITRATION_SLA_HOURS}h`, value: String(summary.overdue) },
          { label: 'Money at stake', value: formatAud(summary.amountAtRiskCents) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border bg-muted/30 p-3">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {stat.label}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {/* The workspace tab strip, shared with every Active/Past section rather than
          restyled here. Three tabs instead of two is the only difference. */}
      <SectionTabs
        label="Filter cases"
        currentKey={scope}
        tabs={[
          { key: 'open', label: 'All open', count: cases.length, href: '/admin/arbitration' },
          {
            key: 'mine',
            label: 'Mine',
            count: cases.filter((c) => c.assigneeId === viewerId).length,
            href: '/admin/arbitration?queue=mine',
          },
          {
            key: 'unassigned',
            label: 'Unassigned',
            count: summary.unassigned,
            href: '/admin/arbitration?queue=unassigned',
          },
        ]}
      />

      {shown.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title={scope === 'mine' ? 'Nothing Assigned to You' : 'Queue Is Clear'}
          titleAs="h3"
          description={
            scope === 'mine'
              ? 'Take a case from the unassigned queue to start working it.'
              : 'No dispute is currently awaiting a decision.'
          }
          compact
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((c) => {
            const priority = PRIORITY_STYLE[c.priority];
            const overdue = c.ageHours >= ARBITRATION_SLA_HOURS;
            return (
              <li key={`${c.kind}:${c.ref}`}>
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={priority.variant}>{priority.label}</Badge>
                        <Badge variant="outline">{CASE_KIND_LABEL[c.kind] ?? c.kind}</Badge>
                        {c.fraudAlleged && <Badge variant="destructive">Fraud alleged</Badge>}
                        <CardTitle className="text-base">
                          <Link
                            href={`/admin/arbitration/${c.kind}/${c.ref}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {c.title}
                          </Link>
                        </CardTitle>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {formatAud(c.amountAtRiskCents)}
                      </span>
                    </div>
                    <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={cn('flex items-center gap-1', overdue && 'text-destructive')}>
                        <Clock className="size-3.5 shrink-0" aria-hidden />
                        {c.openedAt ? formatRelativeTime(c.openedAt) : 'age unknown'}
                        {overdue ? ` · over ${ARBITRATION_SLA_HOURS}h` : ''}
                      </span>
                      {c.hasHardDeadline && c.hoursToDeadline !== null ? (
                        <span
                          className={cn(
                            'flex items-center gap-1',
                            c.hoursToDeadline < DEADLINE_WARNING_HOURS && 'text-destructive',
                          )}
                        >
                          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                          {c.hoursToDeadline < 0
                            ? 'evidence deadline passed'
                            : `${c.hoursToDeadline}h to evidence deadline`}
                        </span>
                      ) : null}
                      {c.noteCount > 0 ? (
                        <span>
                          {c.noteCount} note{c.noteCount === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3">
                    <p className="min-w-0 text-xs text-muted-foreground">
                      {c.parties.map((p) => `${p.role}: ${p.name}`).join(' · ')}
                    </p>
                    <CaseAssignButton
                      caseKind={c.kind}
                      caseRef={c.ref}
                      assigneeId={c.assigneeId}
                      assigneeName={c.assigneeName}
                      viewerId={viewerId}
                    />
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </MarketplaceShell>
  );
}
