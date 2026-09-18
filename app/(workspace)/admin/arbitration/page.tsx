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
import { HugeiconsIcon } from '@hugeicons/react';
import { Clock01Icon, InboxIcon, ShieldAlertIcon, TriangleAlertIcon, Wrench01Icon } from '@hugeicons/core-free-icons';

import { getArbitrationQueue } from '@/lib/actions/arbitration';
import {
  ARBITRATION_SLA_HOURS,
  DEADLINE_WARNING_HOURS,
  SITUATION_LABEL,
  TRIAGE_RULE_SUMMARY,
  filterQueue,
  resolveQueueScope,
  summariseQueue,
  type PriorityReason,
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

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata = {
  title: 'Cases · NoDitto',
};

/**
 * The "why is this here" line per row.
 *
 * Keyed off `priorityReason`, which is derived from the same branch chain as the
 * priority badge beside it, so the badge and the sentence cannot disagree. The wording
 * names the CONSEQUENCE rather than the rule — an arbitrator does not need to be told
 * a case is CRITICAL, they need to be told that letting the deadline pass forfeits the
 * money automatically.
 */
const PRIORITY_REASON_LABEL: Record<PriorityReason, string> = {
  EVIDENCE_DEADLINE:
    'Top of the queue: the evidence deadline is close, and once it passes the money is forfeited automatically.',
  FRAUD_ALLEGED:
    'Raised: fraud is alleged, and the collateral behind the remedy expires in about a week.',
  PAST_SLA: `Raised: nobody has answered this in ${ARBITRATION_SLA_HOURS} hours.`,
  IN_ORDER: 'Waiting its turn. Nothing has escalated it.',
};

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
          variant="page"
          icon={<HugeiconsIcon icon={ShieldAlertIcon} className="size-6" aria-hidden />}
          title="Not Authorized"
          titleAs="h3"
          description="Cases are limited to NoDitto support staff."
          action={{ label: 'Return home', href: '/', variant: 'outline' }}
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
              <Link href="/admin" transitionTypes={['nav-back']}>
                <HugeiconsIcon icon={Wrench01Icon} aria-hidden />
                Operations
              </Link>
            </Button>
          ) : undefined
        }
      />

      {/* The headline numbers an arbitrator triages on. Money is shown but is
          deliberately not what drives the ordering. */}
      <dl className="mb-6 grid grid-cols-2 gap-cozy sm:grid-cols-4">
        {[
          { label: 'Open cases', value: String(summary.total) },
          { label: 'Critical', value: String(summary.critical) },
          { label: `Over ${ARBITRATION_SLA_HOURS}h`, value: String(summary.overdue) },
          { label: 'Money at stake', value: formatAud(summary.amountAtRiskCents) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border bg-muted p-cozy">
            <dt className="text-meta uppercase tracking-wide text-muted-foreground">
              {stat.label}
            </dt>
            <dd className="mt-0.5 text-subhead font-semibold tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {/* THE ORDERING RULE IS PUBLISHED, not left in a code comment. A queue that sorts
          itself by an invisible rule gets argued with — and worse, worked around: a
          worker who cannot see why a $40 case outranks a $4,000 one starts picking by
          amount, which is the exact behaviour the rule exists to prevent. The string
          lives beside the derivation in `arbitrationCase.ts`, so publishing it and
          changing it are one edit. */}
      <p className="mb-5 rounded-md border border-border bg-muted px-cozy py-snug text-meta text-muted-foreground">
        {TRIAGE_RULE_SUMMARY}
      </p>

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
          icon={<HugeiconsIcon icon={InboxIcon} className="size-6" aria-hidden />}
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
        <ul className="space-y-cozy">
          {shown.map((c) => {
            const priority = PRIORITY_STYLE[c.priority];
            const overdue = c.ageHours >= ARBITRATION_SLA_HOURS;
            return (
              <li key={`${c.kind}:${c.ref}`}>
                <Card>
                  <CardHeader className="pb-cozy">
                    <div className="flex flex-wrap items-center justify-between gap-snug">
                      <div className="flex flex-wrap items-center gap-snug">
                        <Badge variant={priority.variant}>{priority.label}</Badge>
                        <Badge variant="outline">{SITUATION_LABEL[c.situation] ?? CASE_KIND_LABEL[c.kind] ?? c.kind}</Badge>
                        {c.fraudAlleged && <Badge variant="destructive">Fraud alleged</Badge>}
                        <CardTitle className="text-lead">
                          <Link
                            href={`/admin/arbitration/${c.kind}/${c.ref}`}
                            className="text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground"
                          >
                            {c.title}
                          </Link>
                        </CardTitle>
                      </div>
                      <span className="shrink-0 text-body font-semibold tabular-nums">
                        {formatAud(c.amountAtRiskCents)}
                      </span>
                    </div>
                    <CardDescription className="flex flex-wrap items-center gap-x-cozy gap-y-tight">
                      <span className={cn('flex items-center gap-tight', overdue && 'text-destructive')}>
                        <HugeiconsIcon icon={Clock01Icon} className="size-3.5 shrink-0" aria-hidden />
                        {c.openedAt ? formatRelativeTime(c.openedAt) : 'age unknown'}
                        {overdue ? ` · over ${ARBITRATION_SLA_HOURS}h` : ''}
                      </span>
                      {c.hasHardDeadline && c.hoursToDeadline !== null ? (
                        <span
                          className={cn(
                            'flex items-center gap-tight',
                            c.hoursToDeadline < DEADLINE_WARNING_HOURS && 'text-destructive',
                          )}
                        >
                          <HugeiconsIcon icon={TriangleAlertIcon} className="size-3.5 shrink-0" aria-hidden />
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
                  <CardContent className="space-y-cozy">
                    {/* WHY THIS ROW IS WHERE IT IS. The badges above say what the case
                        IS and how urgent it looks; this says which of the four rules put
                        it there, in the same words for every case with that reason. */}
                    <p
                      className={cn(
                        'text-meta',
                        c.priorityReason === 'EVIDENCE_DEADLINE'
                          ? 'font-medium text-destructive'
                          : 'text-muted-foreground',
                      )}
                    >
                      {PRIORITY_REASON_LABEL[c.priorityReason]}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-cozy">
                    <p className="min-w-0 text-body text-muted-foreground">
                      {c.parties.map((p) => `${p.role}: ${p.name}`).join(' · ')}
                    </p>
                    <div className="flex items-center gap-snug">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/arbitration/${c.kind}/${c.ref}`} transitionTypes={['nav-forward']}>
                          Open case
                        </Link>
                      </Button>
                      <CaseAssignButton
                        caseKind={c.kind}
                        caseRef={c.ref}
                        assigneeId={c.assigneeId}
                        assigneeName={c.assigneeName}
                        viewerId={viewerId}
                      />
                    </div>
                    </div>
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
