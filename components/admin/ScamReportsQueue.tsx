// components/admin/ScamReportsQueue.tsx
//
// The Scam reports tab of the Operations console (scam-reports spec, Req 5–9).
//
// ONE CARD PER CLUSTER, not per report: reports that share a payment detail or handle
// are about the same scammer, and what matters is how many independent people stand
// behind it. The header says that number and the masked details they share. Inside,
// each report has its story, screenshots and reporter, then the NoDitto members whose
// own details matched it.
//
// Nothing on this tab happens by itself. A match is a lead for a person to check, a
// member is told before anything is decided against them, and a ban needs two admins.

import Link from 'next/link';

import { ScamMatchActions, ScamReportActions } from '@/components/admin/ScamReportActions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  SCAM_IDENTIFIER_KIND_LABEL,
  SCAM_PAYMENT_METHODS,
  type ScamMatchStrength,
  type ScamReportStatus,
} from '@/domain/risk/scamReportVocabulary';
import type { ScamQueueCluster, ScamQueuePhoto } from '@/lib/risk/scamQueue';
import { formatMoney, formatRelativeTime, formatShortDate } from '@/lib/format';

const METHOD_LABEL = new Map<string, string>(SCAM_PAYMENT_METHODS.map((option) => [option.value, option.label]));

const STATUS_VARIANT: Record<ScamReportStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  SUBMITTED: 'default',
  REVIEWED: 'secondary',
  CORROBORATED: 'destructive',
  DISMISSED: 'outline',
  WITHDRAWN: 'outline',
};

const STRENGTH_VARIANT: Record<ScamMatchStrength, 'destructive' | 'default' | 'secondary'> = {
  STRONG: 'destructive',
  MEDIUM: 'default',
  WEAK: 'secondary',
};

const STRENGTH_HINT: Record<ScamMatchStrength, string> = {
  STRONG: 'a payment detail matched exactly',
  MEDIUM: 'BSB and last 4 of their payout account matched',
  WEAK: 'handle only, which scammers copy',
};

function monthLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function strengthLabel(strength: number): string {
  if (strength === 0) return 'No live reports';
  const whole = Number.isInteger(strength) ? String(strength) : strength.toFixed(1);
  return `${whole} independent reporter${strength === 1 ? '' : 's'}`;
}

function PhotoGrid({ photos, label }: { photos: ScamQueuePhoto[]; label: string }) {
  if (photos.length === 0) return null;
  return (
    <ul className="grid grid-cols-4 gap-snug sm:grid-cols-6">
      {photos.map((photo, index) => (
        <li key={photo.path} className="aspect-square overflow-hidden rounded-md border border-border bg-card">
          {photo.url ? (
            <a
              href={photo.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${label} ${index + 1} in a new tab`}
              className="block size-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* A short-lived signed URL; the optimizer cannot cache it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="size-full object-cover" />
            </a>
          ) : (
            <span className="grid size-full place-items-center text-meta text-muted-foreground">Unavailable</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ScamReportsQueue({
  clusters,
  toReview,
  showingClosed,
}: {
  clusters: ScamQueueCluster[];
  /** Reports nobody has looked at yet. */
  toReview: number;
  showingClosed: boolean;
}) {
  return (
    <section aria-labelledby="scams-heading">
      <div className="mb-group flex flex-wrap items-center justify-between gap-cozy">
        <div className="flex flex-wrap items-center gap-snug">
          <h3 id="scams-heading" className="text-subhead font-semibold">
            Off-platform scam reports
          </h3>
          <Badge variant={toReview > 0 ? 'default' : 'secondary'}>{toReview} to review</Badge>
        </div>
        <div className="flex w-full flex-wrap gap-tight md:w-auto">
          <Button asChild size="sm" variant={showingClosed ? 'ghost' : 'outline'}>
            <Link href="/admin?tab=scams">Open</Link>
          </Button>
          <Button asChild size="sm" variant={showingClosed ? 'outline' : 'ghost'}>
            <Link href="/admin?tab=scams&view=all">All</Link>
          </Button>
        </div>
      </div>

      <p className="mb-group text-body text-muted-foreground">
        Scams members reported from outside NoDitto, grouped when they share a payment detail or
        handle. Matches are NoDitto members whose own details are the same. A match is a lead, not
        a finding: check it, tell the member, and read their side first. A ban needs at least two
        independent reporters and a second admin. Never shown to members.
      </p>

      {clusters.length === 0 ? (
        <EmptyState
          title="No scam reports"
          titleAs="h4"
          description={showingClosed ? 'Nothing has been reported yet.' : 'Nothing open right now.'}
          compact
        />
      ) : (
        <ul className="space-y-group">
          {clusters.map((cluster) => (
            <li key={cluster.key}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-snug">
                    <div className="flex flex-wrap items-center gap-snug">
                      <Badge variant={cluster.corroborated ? 'destructive' : 'secondary'}>
                        {cluster.corroborated ? 'Corroborated' : 'Single source'}
                      </Badge>
                      <CardTitle className="text-lead">{strengthLabel(cluster.strength)}</CardTitle>
                    </div>
                    <span className="shrink-0 text-meta text-muted-foreground">
                      latest {formatRelativeTime(cluster.newestAt)}
                    </span>
                  </div>
                  <CardDescription className="break-words">
                    {cluster.hints.length > 0 ? cluster.hints.join(' · ') : 'No details on file'}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-group">
                  {cluster.reports.map((report) => (
                    <article
                      key={report.id}
                      aria-label={`Report filed ${formatShortDate(report.createdAt) ?? ''}`}
                      className="space-y-cozy rounded-lg border border-border p-cozy"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-snug">
                        <div className="flex flex-wrap items-center gap-snug">
                          <Badge variant={STATUS_VARIANT[report.status]}>{report.status}</Badge>
                          <span className="text-body font-medium text-foreground">
                            {METHOD_LABEL.get(report.paymentMethod) ?? report.paymentMethod}
                            {report.amountMinor != null && report.currency
                              ? ` · ${formatMoney(report.amountMinor, report.currency)}`
                              : ''}
                            {' · '}
                            {monthLabel(report.occurredMonth)}
                          </span>
                        </div>
                        <span className="shrink-0 text-meta text-muted-foreground">
                          filed {formatRelativeTime(report.createdAt)}
                        </span>
                      </div>

                      <dl className="grid grid-cols-1 gap-tight text-meta text-muted-foreground sm:grid-cols-2">
                        <div>
                          <dt className="inline font-medium text-foreground">Reporter: </dt>
                          <dd className="inline">
                            {report.reporter ? (
                              <>
                                <Link
                                  href={`/sellers/${report.reporter.id}`}
                                  transitionTypes={['nav-forward']}
                                  className="underline underline-offset-2 hover:text-foreground"
                                >
                                  {report.reporter.displayName}
                                </Link>
                                {report.reporter.verified ? ', ID verified' : ', not verified'}
                                {report.reporter.joinedAt ? `, joined ${formatShortDate(report.reporter.joinedAt)}` : ''}
                                {`, ${report.reporter.completedDeals} completed deal${report.reporter.completedDeals === 1 ? '' : 's'}`}
                                {report.reporter.ratingCount > 0 && report.reporter.rating != null
                                  ? `, rated ${report.reporter.rating.toFixed(1)} from ${report.reporter.ratingCount}`
                                  : ', no ratings yet'}
                                {report.reporter.reportCount > 1 ? `, ${report.reporter.reportCount} reports` : ''}
                                {report.reporter.fraudBanned ? ', suspended for fraud' : ''}
                              </>
                            ) : (
                              'Account closed'
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline font-medium text-foreground">Name they gave: </dt>
                          <dd className="inline break-words">{report.scammerName ?? '—'}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="inline font-medium text-foreground">Details: </dt>
                          <dd className="inline break-words">
                            {report.identifiers.length === 0
                              ? '—'
                              : report.identifiers.map((identifier) => identifier.hint).join(' · ')}
                          </dd>
                        </div>
                        {report.dismissReason ? (
                          <div className="sm:col-span-2">
                            <dt className="inline font-medium text-foreground">Dismissed because: </dt>
                            <dd className="inline break-words">{report.dismissReason}</dd>
                          </div>
                        ) : null}
                      </dl>

                      <div className="space-y-snug rounded-lg border border-border bg-muted/40 p-cozy">
                        <p className="text-meta font-medium text-foreground">What they told us</p>
                        <p className="whitespace-pre-line break-words text-body text-foreground">{report.narrative}</p>
                        <PhotoGrid photos={report.evidence} label="screenshot" />
                      </div>

                      {report.matches.length > 0 ? (
                        <div className="space-y-snug">
                          <p className="text-meta font-medium text-foreground">
                            Matched NoDitto members ({report.matches.length})
                          </p>
                          <ul className="space-y-snug">
                            {report.matches.map((match) => (
                              <li
                                key={match.profileId}
                                className="space-y-snug rounded-lg border border-border p-cozy"
                              >
                                <div className="flex flex-wrap items-center gap-snug">
                                  <Badge variant={STRENGTH_VARIANT[match.strength]}>{match.strength}</Badge>
                                  {match.status === 'CONFIRMED' ? <Badge variant="outline">Confirmed</Badge> : null}
                                  <Link
                                    href={`/sellers/${match.profileId}`}
                                    transitionTypes={['nav-forward']}
                                    className="text-body font-medium underline underline-offset-2 hover:text-foreground"
                                  >
                                    {match.displayName}
                                  </Link>
                                  <span className="text-meta text-muted-foreground">
                                    {match.kinds.map((kind) => SCAM_IDENTIFIER_KIND_LABEL[kind] ?? kind).join(', ')}:{' '}
                                    {STRENGTH_HINT[match.strength]}
                                  </span>
                                </div>

                                <p className="text-meta text-muted-foreground">
                                  {match.notifiedAt
                                    ? match.respondedAt
                                      ? `Told ${formatShortDate(match.notifiedAt)}, responded ${formatShortDate(match.respondedAt)}.`
                                      : `Told ${formatShortDate(match.notifiedAt)}, response due ${formatShortDate(match.responseDueAt) ?? '—'}.`
                                    : 'Not told yet.'}
                                  {match.banProposedAt
                                    ? ` Ban proposed by ${match.banProposedByName ?? 'an admin'} ${formatRelativeTime(match.banProposedAt)}.`
                                    : ''}
                                  {match.exposureOverrideMinor === 0 ? ' Selling paused.' : ''}
                                  {match.trustedSellerStatus ? (
                                    <>
                                      {' '}
                                      <Link
                                        href="/admin?tab=trusted"
                                        className="underline underline-offset-2 hover:text-foreground"
                                      >
                                        Trusted Seller application: {match.trustedSellerStatus.toLowerCase()}
                                      </Link>
                                      .
                                    </>
                                  ) : null}
                                </p>

                                {match.response ? (
                                  <div className="space-y-snug rounded-lg border border-border bg-muted/40 p-cozy">
                                    <p className="text-meta font-medium text-foreground">Their side</p>
                                    <p className="whitespace-pre-line break-words text-body text-foreground">
                                      {match.response}
                                    </p>
                                    <PhotoGrid photos={match.responsePhotos} label="response photo" />
                                  </div>
                                ) : null}

                                <ScamMatchActions
                                  reportId={report.id}
                                  profileId={match.profileId}
                                  displayName={match.displayName}
                                  status={match.status}
                                  notified={Boolean(match.notifiedAt)}
                                  fraudBanned={match.fraudBanned}
                                  banProposed={Boolean(match.banProposedAt)}
                                  banBlockedReason={match.banBlockedReason}
                                  sellingPaused={match.exposureOverrideMinor === 0}
                                />
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="text-meta text-muted-foreground">No NoDitto member matches these details.</p>
                      )}

                      <ScamReportActions reportId={report.id} status={report.status} notes={report.staffNotes} />
                    </article>
                  ))}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
