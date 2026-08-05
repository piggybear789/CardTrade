// components/arbitration/ArbitrationCaseView.tsx
//
// One arbitration case, with everything needed to decide it and nothing else.
//
// WHY A COMPONENT AND NOT A PAGE BODY. Every other detail surface in the workspace â€”
// `/trades/[id]`, `/sales/[id]`, `/deals/[id]`, `/messages/[id]` â€” keeps its route file
// thin (auth, fetch, redirect) and hands the whole room to a component. This started
// life inlined in the route, which made the arbitration route the only detail page
// shaped differently from the rest.
//
// LAYOUT REFLECTS THE ORDER OF WORK: what is claimed, who is affected and what each
// stands to lose, what the record shows, what staff have already noted â€” and only then
// the controls that move money. Putting the buttons last is not decoration; the outcome
// is irreversible, so the evidence should be behind the arbitrator's eyes before the
// button is under their cursor.
//
// HEADING LEVELS. MarketplaceShell owns the <h1> and SectionHeader the <h2>, so the
// sections here are <h3> â€” matching PayoutsDashboard. They were <h2> when inlined,
// which put them at the same level as the page title they sit underneath.

import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Clock, ExternalLink } from 'lucide-react';

import type { ArbitrationCaseDetail } from '@/lib/actions/arbitration';
import {
  ARBITRATION_SLA_HOURS,
  DEADLINE_WARNING_HOURS,
  type ArbitrationPriority,
} from '@/domain/arbitration/arbitrationCase';
import { CaseNoteComposer } from '@/components/arbitration/CaseNoteComposer';

import { DisputeActions } from '@/components/admin/DisputeActions';
import { TradeDisputeActions } from '@/components/admin/TradeDisputeActions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatAud, formatContractDateTime, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Badge treatment per priority band. Shared with the queue. */
export const PRIORITY_STYLE: Record<
  ArbitrationPriority,
  { label: string; variant: 'destructive' | 'default' | 'secondary' }
> = {
  CRITICAL: { label: 'Critical', variant: 'destructive' },
  HIGH: { label: 'High', variant: 'default' },
  NORMAL: { label: 'Normal', variant: 'secondary' },
};

/** Human label per case kind. Shared with the queue so the two cannot disagree. */
export const CASE_KIND_LABEL: Record<string, string> = {
  CASH_SALE: 'Sale dispute',
  TRADE: 'Trade dispute',
  CHARGEBACK: 'Chargeback',
  DEAL: 'Deal dispute',
};

/** Turn an event key like `HANDOVER_CONFIRMED` into readable prose. */
function humaniseEvent(event: string): string {
  const words = event.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function ArbitrationCaseView({ detail }: { detail: ArbitrationCaseDetail }) {
  const { case: c, notes, timeline, resolution } = detail;
  const priority = PRIORITY_STYLE[c.priority];
  const overdue = c.ageHours >= ARBITRATION_SLA_HOURS;

  return (
    <>
      {/* Arbitration is the one workspace surface absent from the rail, so it is also
          the one that needs an explicit way back. Detail pages elsewhere rely on the
          rail and mobile hubs, which do not list this route. */}
      <Link
        href="/admin/arbitration"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to the queue
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge variant={priority.variant}>{priority.label}</Badge>
        <Badge variant="outline">{CASE_KIND_LABEL[c.kind] ?? c.kind}</Badge>
        {c.fraudAlleged && <Badge variant="destructive">Fraud alleged</Badge>}
        <span
          className={cn(
            'inline-flex items-center gap-1 text-xs text-muted-foreground',
            overdue && 'text-destructive',
          )}
        >
          <Clock className="size-3.5 shrink-0" aria-hidden />
          Raised {c.openedAt ? formatRelativeTime(c.openedAt) : 'at an unrecorded time'}
          {overdue ? ` Â· over ${ARBITRATION_SLA_HOURS}h old` : ''}
        </span>
        {c.hasHardDeadline && c.hoursToDeadline !== null ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs',
              c.hoursToDeadline < DEADLINE_WARNING_HOURS
                ? 'text-destructive'
                : 'text-muted-foreground',
            )}
          >
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {c.hoursToDeadline < 0
              ? 'Evidence deadline has passed'
              : `${c.hoursToDeadline}h until the evidence deadline`}
          </span>
        ) : null}
      </div>

      {/* 1. The claim, in the claimant's words. Framed as an allegation throughout:
             the arbitrator's job is to decide it, not to enact it. */}
      <section aria-labelledby="claim-heading" className="mb-8">
        <h3 id="claim-heading" className="mb-3 text-xl font-semibold">
          The claim
        </h3>
        {c.claim ? (
          <blockquote className="whitespace-pre-line break-words rounded-lg border bg-muted/40 p-4 text-sm">
            {c.claim}
          </blockquote>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            No written reason was recorded when this was raised.
          </p>
        )}
        {c.raisedById ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Raised by {c.parties.find((p) => p.id === c.raisedById)?.name ?? 'a party'}.
            This is an allegation, not a finding.
          </p>
        ) : null}
      </section>

      {/* 2. Who is affected, and by how much. */}
      <section aria-labelledby="parties-heading" className="mb-8">
        <h3 id="parties-heading" className="mb-3 text-xl font-semibold">
          Parties
        </h3>
        {c.parties.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            The provider did not attribute this case to a member.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {c.parties.map((party) => (
              <li key={party.id}>
                <Card>
                  <CardHeader className="pb-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {party.role}
                    </p>
                    <CardTitle className="text-base">
                      <Link
                        href={`/sellers/${party.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {party.name}
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm tabular-nums">
                      {formatAud(party.stakeCents)}{' '}
                      <span className="text-muted-foreground">at stake</span>
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. What the record shows. Only cash sales and deals keep an event log; a trade
             or chargeback says so rather than showing an empty box that reads as
             "nothing happened". */}
      <section aria-labelledby="timeline-heading" className="mb-8">
        <h3 id="timeline-heading" className="mb-3 text-xl font-semibold">
          Contract timeline
        </h3>
        {timeline.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            {c.kind === 'CASH_SALE'
              ? 'No events were recorded against this sale.'
              : 'This case kind keeps no event log. Open the contract to read its history.'}
          </p>
        ) : (
          <ol className="space-y-2 border-l border-border/70 pl-4">
            {timeline.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="relative text-sm">
                <span
                  aria-hidden
                  className="absolute -left-[1.3125rem] top-1.5 size-2 rounded-full bg-border"
                />
                <p className="font-medium">{humaniseEvent(entry.event)}</p>
                {entry.detail ? (
                  <p className="break-words text-muted-foreground">{entry.detail}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {formatContractDateTime(entry.at) ?? entry.at}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 4. Internal notes. Staff-only and append-only â€” see the composer. */}
      <section aria-labelledby="notes-heading" className="mb-8">
        <h3 id="notes-heading" className="mb-3 text-xl font-semibold">
          Internal notes
          {notes.length > 0 ? (
            <span className="ml-2 align-middle text-sm font-normal text-muted-foreground">
              {notes.length}
            </span>
          ) : null}
        </h3>
        <div className="space-y-4">
          <CaseNoteComposer caseKind={c.kind} caseRef={c.ref} />
          {notes.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              Nobody has written anything on this case yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {notes.map((note) => (
                <li key={note.id} className="rounded-lg border bg-card p-3">
                  <p className="whitespace-pre-line break-words text-sm">{note.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {note.authorName} Â· {formatRelativeTime(note.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 5. The decision. Last on purpose. */}
      <section aria-labelledby="outcome-heading" className="mb-4">
        <h3 id="outcome-heading" className="mb-3 text-xl font-semibold">
          Decision
        </h3>

        {resolution === null ? (
          <p className="text-sm italic text-muted-foreground">
            The underlying record could not be read, so no outcome can be applied from
            here.
          </p>
        ) : resolution.kind === 'CASH_SALE' ? (
          <div className="space-y-3">
            {resolution.refundStatus === 'FAILED' ? (
              <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  A previous refund attempt was refused by the provider. Retrying is
                  safe: the refund reuses this sale&apos;s stored key, so a second
                  attempt is deduplicated rather than refunding twice.
                </span>
              </p>
            ) : null}
            {resolution.refundCents > 0 ? (
              <p className="text-xs text-muted-foreground">
                {formatAud(resolution.refundCents)} has already been refunded on this
                sale.
              </p>
            ) : null}
            <DisputeActions
              cashSaleId={resolution.cashSaleId}
              amountCents={resolution.amountCents}
              platformFeeCents={resolution.platformFeeCents}
            />
          </div>
        ) : resolution.kind === 'TRADE' ? (
          <TradeDisputeActions
            tradeId={resolution.tradeId}
            initiator={resolution.initiator}
            counterpart={resolution.counterpart}
            fraudClaimedById={resolution.fraudClaimedById}
            frictionTaxCents={resolution.frictionTaxCents}
          />
        ) : (
          // A chargeback is decided by the cardholder's bank, not by us. Pretending
          // otherwise with a resolve button would be a lie about who holds the
          // outcome â€” the only thing staff can do here is submit evidence in the
          // provider dashboard before the deadline, and record what they sent.
          //
          // This panel carries the provider ref and the dashboard link because
          // chargebacks are no longer duplicated on /admin: this is the only surface
          // that shows them, so everything needed to act has to be here.
          <div className="space-y-3 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
            <p className="font-medium">This one is not ours to decide.</p>
            <p className="text-muted-foreground">
              The cardholder&apos;s bank rules on a chargeback. Submit evidence in the
              Stripe dashboard, then note here what was sent â€” missing the deadline
              forfeits the amount automatically, with no appeal.
            </p>

            <dl className="grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                <dt className="inline font-medium text-foreground">Provider status: </dt>
                <dd className="inline">{resolution.providerStatus ?? 'unreported'}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Evidence due: </dt>
                <dd className="inline">
                  {resolution.evidenceDueBy
                    ? (formatContractDateTime(resolution.evidenceDueBy) ??
                      resolution.evidenceDueBy)
                    : 'not reported by the provider'}
                </dd>
              </div>
              {resolution.outcome ? (
                <div>
                  <dt className="inline font-medium text-foreground">Outcome: </dt>
                  <dd className="inline">
                    {resolution.outcome}
                    {resolution.outcome === 'lost'
                      ? ' â€” the platform absorbed this amount'
                      : ''}
                  </dd>
                </div>
              ) : null}
              {resolution.disputeRef ? (
                <div className="sm:col-span-2">
                  <dt className="inline font-medium text-foreground">Dispute ref: </dt>
                  <dd className="inline break-all font-mono">{resolution.disputeRef}</dd>
                </div>
              ) : null}
            </dl>

            <Button asChild size="sm" variant="outline">
              <a
                href="https://dashboard.stripe.com/disputes"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Stripe
                <ExternalLink aria-hidden />
              </a>
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
