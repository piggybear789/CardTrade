// components/admin/TrustedSellersQueue.tsx
//
// The Trusted Seller tab of the Operations console (0152).
//
// A starting point for a manual review, not the review itself: the decision is made
// off-platform, so each card carries what an operator needs to begin (who the member
// is to Stripe, where they sell, their application answers, what they have done here so
// far) plus a place to keep notes across sessions. Nothing on this tab moves money.
//
// ORDER: pending reviews whose member has passed the ID check first (those can be
// decided today), then pending reviews still waiting on the ID check, then decided
// ones, newest decision first.

import Link from 'next/link';

import { TrustedSellerActions } from '@/components/admin/TrustedSellerActions';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { parseSocialLinks } from '@/domain/social/socialLinks';
import { regionLabel } from '@/domain/region';
import type { TrustedSellerReviewStatus } from '@/domain/trustedSellers/trustedSellerReview';
import { formatRelativeTime, formatShortDate } from '@/lib/format';

/** One review with the member facts the card shows. Built by the console page. */
export interface TrustedSellerQueueRow {
  id: string;
  profileId: string;
  status: TrustedSellerReviewStatus;
  /** Legacy 0152 application: one Instagram handle and nothing else. */
  instagramHandle: string | null;
  /** The applicant's own account of their selling (0153). */
  details: string | null;
  /** Their photos, signed for this render. */
  photos: { path: string; url: string | null }[];
  staffNotes: string | null;
  requestedAt: string;
  decidedAt: string | null;
  /** `ACCOUNT_SUSPENDED` / `ACCOUNT_CLOSED` when the system ended the review. */
  decisionReason: string | null;
  displayName: string;
  /** The Stripe Identity name. Staff-only; never shown to members here. */
  verifiedName: string | null;
  identityVerified: boolean;
  regionCode: string | null;
  joinedAt: string | null;
  socialLinks: Record<string, string> | null;
  rating: number | null;
  ratingCount: number;
  listingCount: number;
  completedSales: number;
  /** Open off-platform scam report matches on this member (0154). */
  scamMatchCount: number;
}

const STATUS_VARIANT: Record<TrustedSellerReviewStatus, 'default' | 'secondary' | 'outline' | 'trust'> = {
  PENDING: 'default',
  APPROVED: 'trust',
  DECLINED: 'outline',
  REVOKED: 'outline',
};

const SYSTEM_REASON: Record<string, string> = {
  ACCOUNT_SUSPENDED: 'ended automatically: account suspended for fraud',
  ACCOUNT_CLOSED: 'ended automatically: account closed',
};

/** Pending-and-ready, then pending-waiting-on-ID, then decided (newest first). */
export function sortTrustedSellerQueue(rows: TrustedSellerQueueRow[]): TrustedSellerQueueRow[] {
  const rank = (row: TrustedSellerQueueRow) =>
    row.status === 'PENDING' ? (row.identityVerified ? 0 : 1) : 2;
  return [...rows].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (rank(a) < 2) return a.requestedAt.localeCompare(b.requestedAt);
    return (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '');
  });
}

export function TrustedSellersQueue({
  rows,
  readyCount,
}: {
  rows: TrustedSellerQueueRow[];
  /** Pending reviews whose member has passed the ID check. */
  readyCount: number;
}) {
  return (
    <section aria-labelledby="trusted-heading">
      <div className="mb-group flex items-center gap-snug">
        <h3 id="trusted-heading" className="text-subhead font-semibold">
          Trusted Seller reviews
        </h3>
        <Badge variant={readyCount > 0 ? 'default' : 'secondary'}>{readyCount} ready</Badge>
      </div>

      <p className="mb-group text-body text-muted-foreground">
        Members who applied from the Trusted Seller page. Read what they told us, check it
        yourself, keep notes here, then decide. Approving adds the badge and
        raises their open-sales limit; it never skips the ID check, and approval stays locked
        until that has passed. Nothing here moves money.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title="No applications"
          titleAs="h4"
          description="Nobody has applied to be a Trusted Seller yet."
          compact
        />
      ) : (
        <ul className="space-y-group">
          {rows.map((row) => {
            const links = parseSocialLinks(row.socialLinks);
            return (
              <li key={row.id}>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-snug">
                      <div className="flex flex-wrap items-center gap-snug">
                        <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
                        <Badge variant={row.identityVerified ? 'trust' : 'secondary'}>
                          {row.identityVerified ? 'ID verified' : 'ID not verified yet'}
                        </Badge>
                        <CardTitle className="text-lead">{row.displayName}</CardTitle>
                      </div>
                      <span className="shrink-0 text-meta text-muted-foreground">
                        applied {formatRelativeTime(row.requestedAt)}
                      </span>
                    </div>
                    <CardDescription className="break-words">
                      <Link
                        href={`/sellers/${row.profileId}`}
                        transitionTypes={['nav-forward']}
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        Public profile
                      </Link>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-group">
                    {row.scamMatchCount > 0 ? (
                      // A lead, not a finding: the Scams tab is where it gets checked.
                      <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-cozy text-body text-foreground">
                        Their details match{' '}
                        {row.scamMatchCount === 1 ? 'an off-platform scam report' : `${row.scamMatchCount} off-platform scam reports`}
                        .{' '}
                        <Link
                          href="/admin?tab=scams"
                          className="font-medium underline underline-offset-2 hover:text-foreground"
                        >
                          Check before deciding
                        </Link>
                      </p>
                    ) : null}
                    <dl className="grid grid-cols-1 gap-tight text-meta text-muted-foreground sm:grid-cols-2">
                      <div>
                        <dt className="inline font-medium text-foreground">Verified name: </dt>
                        <dd className="inline">{row.verifiedName ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-foreground">Region: </dt>
                        <dd className="inline">{row.regionCode ? regionLabel(row.regionCode) : '—'}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-foreground">Joined: </dt>
                        <dd className="inline">{formatShortDate(row.joinedAt) ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-foreground">Rating: </dt>
                        <dd className="inline">
                          {row.ratingCount > 0 && row.rating != null
                            ? `${row.rating.toFixed(1)} from ${row.ratingCount}`
                            : 'No ratings yet'}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-foreground">Listings: </dt>
                        <dd className="inline">{row.listingCount}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-foreground">Completed sales: </dt>
                        <dd className="inline">{row.completedSales}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="inline font-medium text-foreground">Profile links: </dt>
                        <dd className="inline break-words">
                          {links.length === 0
                            ? '—'
                            : links.map((link, index) => (
                                <span key={link.slug}>
                                  {index > 0 ? ' · ' : null}
                                  {link.url ? (
                                    <a
                                      href={link.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="underline underline-offset-2 hover:text-foreground"
                                    >
                                      {link.label}: {link.handle}
                                    </a>
                                  ) : (
                                    `${link.label}: ${link.handle}`
                                  )}
                                </span>
                              ))}
                        </dd>
                      </div>
                      {row.decidedAt ? (
                        <div className="sm:col-span-2">
                          <dt className="inline font-medium text-foreground">Decided: </dt>
                          <dd className="inline">
                            {formatShortDate(row.decidedAt)}
                            {row.decisionReason && SYSTEM_REASON[row.decisionReason]
                              ? `, ${SYSTEM_REASON[row.decisionReason]}`
                              : null}
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    {/* WHAT THEY TOLD US, in their own words, then their photos. */}
                    <div className="space-y-snug rounded-lg border border-border bg-muted/40 p-cozy">
                      <p className="text-meta font-medium text-foreground">Their application</p>
                      <p className="whitespace-pre-line break-words text-body text-foreground">
                        {row.details ??
                          (row.instagramHandle ? `Instagram: @${row.instagramHandle}` : 'Nothing written.')}
                      </p>
                      {row.photos.length > 0 ? (
                        <ul className="grid grid-cols-4 gap-snug sm:grid-cols-6">
                          {row.photos.map((photo, index) => (
                            <li key={photo.path} className="aspect-square overflow-hidden rounded-md border border-border bg-card">
                              {photo.url ? (
                                <a
                                  href={photo.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`Open photo ${index + 1} in a new tab`}
                                  className="block size-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  {/* A short-lived signed URL; the optimizer cannot cache it. */}
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={photo.url} alt="" className="size-full object-cover" />
                                </a>
                              ) : (
                                <span className="grid size-full place-items-center text-meta text-muted-foreground">
                                  Unavailable
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>

                    <TrustedSellerActions
                      reviewId={row.id}
                      status={row.status}
                      notes={row.staffNotes}
                      identityVerified={row.identityVerified}
                    />
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
