// components/arbitration/ArbitrationCaseView.tsx
//
// One arbitration case, redesigned for clarity.
//
// Layout: a two-column split at lg — left column is the case context (claim,
// goods, timeline, parties), right column is the workspace (notes + decision).
// On mobile everything stacks naturally. The arbitrator reads left-to-right:
// understand what happened, then act.

import Link from 'next/link';
import Image from 'next/image';
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  ExternalLink,
  FileText,
  Gavel,
  Scale,
  Users,
} from 'lucide-react';

import type { ArbitrationCaseDetail } from '@/lib/actions/arbitration';
import type { DisputeEvidenceEntry } from '@/lib/actions/disputeEvidence';
import { isVideoPath } from '@/lib/storage/disputeEvidenceShared';
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

/**
 * One attachment on a party's submission.
 *
 * Video gets real controls rather than a poster frame: the whole reason a trader films
 * an unboxing is so an arbitrator can watch it, and a thumbnail of frame zero is
 * usually a closed box.
 */
function EvidenceMedia({ path, url }: { path: string; url: string | null }) {
  if (!url) {
    return (
      <div className="grid aspect-square place-items-center rounded-md border border-dashed bg-muted/30 px-2 text-center text-[10px] leading-tight text-muted-foreground">
        Unavailable
      </div>
    );
  }

  if (isVideoPath(path)) {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        className="aspect-square w-full rounded-md border bg-black object-contain"
      />
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block aspect-square overflow-hidden rounded-md border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Unoptimised: signed short-lived URLs on a private bucket cannot be cached by
          the image optimiser, so routing them through it only adds a hop that expires. */}
      <Image
        src={url}
        alt="Evidence"
        fill
        unoptimized
        className="object-cover transition-transform group-hover:scale-105"
      />
    </a>
  );
}

/** One party's filed account, as staff read it. */
function EvidenceEntry({ entry }: { entry: DisputeEvidenceEntry }) {
  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{entry.authorName}</p>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {formatContractDateTime(entry.createdAt) ?? entry.createdAt}
        </span>
      </div>
      <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed">
        {entry.statement}
      </p>
      {entry.media.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {entry.media.map((media) => (
            <EvidenceMedia key={media.path} path={media.path} url={media.url} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function ArbitrationCaseView({ detail }: { detail: ArbitrationCaseDetail }) {
  const { case: c, notes, timeline, resolution, evidence } = detail;
  const priority = PRIORITY_STYLE[c.priority];
  const overdue = c.ageHours >= ARBITRATION_SLA_HOURS;

  return (
    <div className="space-y-6">
      {/* Nav + status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/admin/arbitration"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to queue
        </Link>
        {detail.contractHref ? (
          <Button asChild variant="outline" size="sm">
            <Link href={detail.contractHref}>
              <ExternalLink className="size-3.5" aria-hidden />
              View contract room
            </Link>
          </Button>
        ) : null}
      </div>

      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-4 py-3">
        <Badge variant={priority.variant}>{priority.label}</Badge>
        <Badge variant="outline">{CASE_KIND_LABEL[c.kind] ?? c.kind}</Badge>
        {c.fraudAlleged && <Badge variant="destructive">Fraud alleged</Badge>}
        <span className="mx-1 hidden text-border sm:inline">|</span>
        <span
          className={cn(
            'inline-flex items-center gap-1 text-xs',
            overdue ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          <Clock className="size-3.5 shrink-0" aria-hidden />
          Opened {c.openedAt ? formatRelativeTime(c.openedAt) : 'unknown'}
          {overdue ? ` · overdue` : ''}
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
              ? 'Evidence deadline passed'
              : `${c.hoursToDeadline}h to deadline`}
          </span>
        ) : null}
        <span className="ml-auto text-sm font-semibold tabular-nums">
          {formatAud(c.amountAtRiskCents)}
          <span className="ml-1 font-normal text-muted-foreground">at stake</span>
        </span>
      </div>

      {/* Two-column layout: context on left, actions on right */}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* LEFT: Context — what happened */}
        <div className="space-y-6">
          {/* The Claim */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" aria-hidden />
                <CardTitle className="text-base">The dispute</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {c.claim ? (
                <blockquote className="whitespace-pre-line break-words rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
                  &ldquo;{c.claim}&rdquo;
                </blockquote>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  No reason was recorded.
                </p>
              )}
              {c.raisedById ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  — {c.parties.find((p) => p.id === c.raisedById)?.name ?? 'A party'}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* What the parties themselves filed (0082). Placed directly under the claim
              because this is the material the decision is meant to rest on — before it
              existed an arbitrator had one sentence from one side and nothing from the
              other. */}
          <Card className={evidence.length > 0 ? 'border-gold/30' : undefined}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Gavel className="size-4 text-muted-foreground" aria-hidden />
                  <CardTitle className="text-base">Evidence filed by the parties</CardTitle>
                </div>
                {evidence.length > 0 ? (
                  <Badge variant="secondary" className="text-[11px]">
                    {evidence.length}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {evidence.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">
                  {c.kind === 'CHARGEBACK'
                    ? 'A chargeback has no contract room, so neither party can file here.'
                    : 'Neither party has filed a statement. The Dispute tab in their contract room is where they do it.'}
                </p>
              ) : (
                <ul className="space-y-3">
                  {evidence.map((entry) => (
                    <EvidenceEntry key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* What was bought */}
          {c.goods.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">What the contract covered</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {c.goods.map((line, index) => (
                    <li
                      key={index}
                      className="flex items-baseline justify-between gap-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="break-words font-medium">{line.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {line.quantity > 1 ? `${line.quantity} × ` : ''}
                          {formatAud(line.unitPriceCents)}
                          {line.condition ? ` · ${line.condition}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums font-medium">
                        {formatAud(line.quantity * line.unitPriceCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {/* Parties */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" aria-hidden />
                <CardTitle className="text-base">Parties</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {c.parties.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">
                  No parties attributed.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {c.parties.map((party) => (
                    <div key={party.id} className="rounded-md border p-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {party.role}
                      </p>
                      <p className="mt-0.5 font-semibold">
                        <Link
                          href={`/sellers/${party.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {party.name}
                        </Link>
                      </p>
                      <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                        {formatAud(party.stakeCents)} at risk
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {timeline.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">
                  {c.kind === 'CASH_SALE'
                    ? 'No events recorded.'
                    : 'Open the contract room to see its history.'}
                </p>
              ) : (
                <ol className="space-y-2">
                  {timeline.map((entry, index) => (
                    <li
                      key={`${entry.at}-${index}`}
                      className="flex items-start gap-3 text-sm"
                    >
                      <span className="mt-1.5 flex size-2 shrink-0 rounded-full bg-border" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-medium">{humaniseEvent(entry.event)}</p>
                          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                            {formatContractDateTime(entry.at) ?? entry.at}
                          </span>
                        </div>
                        {entry.detail ? (
                          <p className="break-words text-xs text-muted-foreground">
                            {entry.detail}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Workspace — notes + decision */}
        <div className="space-y-6">
          {/* Staff notes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Staff notes
                {notes.length > 0 ? (
                  <Badge variant="secondary" className="ml-2 text-[11px]">
                    {notes.length}
                  </Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <CaseNoteComposer caseKind={c.kind} caseRef={c.ref} />
              {notes.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">
                  No notes yet.
                </p>
              ) : (
                <ul className="max-h-64 space-y-2 overflow-y-auto">
                  {notes.map((note) => (
                    <li key={note.id} className="rounded-md border bg-muted/20 p-2.5">
                      <p className="whitespace-pre-line break-words text-xs leading-relaxed">
                        {note.body}
                      </p>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {note.authorName} · {formatRelativeTime(note.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Decision */}
          <Card className="border-gold/40">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Scale className="size-4 text-gold" aria-hidden />
                <CardTitle className="text-base">Decision</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {resolution === null ? (
                <p className="text-sm italic text-muted-foreground">
                  The underlying record could not be read.
                </p>
              ) : resolution.kind === 'CASH_SALE' ? (
                <div className="space-y-3">
                  {resolution.refundStatus === 'FAILED' ? (
                    <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      A previous refund attempt failed. Retrying is safe (deduplicated).
                    </p>
                  ) : null}
                  {resolution.refundCents > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {formatAud(resolution.refundCents)} already refunded.
                    </p>
                  ) : null}
                  <DisputeActions
                    cashSaleId={resolution.cashSaleId}
                    amountCents={resolution.amountCents}
                    platformFeeCents={resolution.platformFeeCents}
                  />
                </div>
              ) : resolution.kind === 'TRADE' ? (
                <div className="space-y-3">
                  {resolution.counterpartGoodsDescription ? (
                    <div className="rounded-md bg-muted/30 p-2.5">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Agreed goods
                      </p>
                      <p className="mt-1 whitespace-pre-line break-words text-xs">
                        {resolution.counterpartGoodsDescription}
                      </p>
                    </div>
                  ) : null}
                  <TradeDisputeActions
                    tradeId={resolution.tradeId}
                    initiator={resolution.initiator}
                    counterpart={resolution.counterpart}
                    fraudClaimedById={resolution.fraudClaimedById}
                    frictionTaxCents={resolution.frictionTaxCents}
                  />
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  <p className="font-medium">Not ours to decide</p>
                  <p className="text-xs text-muted-foreground">
                    The cardholder&apos;s bank decides chargebacks. Submit evidence in
                    Stripe, then note what was sent.
                  </p>
                  <dl className="grid gap-1 text-xs text-muted-foreground">
                    <div>
                      <dt className="inline font-medium text-foreground">Status: </dt>
                      <dd className="inline">{resolution.providerStatus ?? 'unreported'}</dd>
                    </div>
                    {resolution.evidenceDueBy ? (
                      <div>
                        <dt className="inline font-medium text-foreground">Due: </dt>
                        <dd className="inline">
                          {formatContractDateTime(resolution.evidenceDueBy) ?? resolution.evidenceDueBy}
                        </dd>
                      </div>
                    ) : null}
                    {resolution.outcome ? (
                      <div>
                        <dt className="inline font-medium text-foreground">Outcome: </dt>
                        <dd className="inline">{resolution.outcome}</dd>
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
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
