'use client';

// components/admin/ReferencesQueue.tsx
//
// The References tab of the Operations console (0155): handle claims waiting
// on a bio screenshot check, reference proofs waiting to become
// receipt-checked, and disputed references. Nothing here gates publication:
// positive and negative experiences are already live. Staff only verify
// claims and proof, and decide disputes.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  decideHandleClaim,
  resolveReferenceDispute,
  setReferenceProofChecked,
} from '@/lib/actions/admin';
import { formatRelativeTime } from '@/lib/format';

export interface ReferenceClaimRow {
  id: string;
  platform: string;
  handle: string;
  claimantId: string;
  claimantName: string;
  bioCode: string;
  screenshots: { path: string; url: string | null }[];
  createdAt: string;
}

export interface ReferenceProofRow {
  id: string;
  voucherName: string;
  targetName: string;
  targetId: string | null;
  platform: string;
  role: string;
  dateLabel: string | null;
  screenshots: { path: string; url: string | null }[];
}

export interface ReferenceDisputeRow {
  id: string;
  voucherName: string;
  targetName: string;
  targetId: string | null;
  sentiment: string;
  categoryLabel: string | null;
  comment: string | null;
  disputedAt: string | null;
}

function ScreenshotStrip({ screenshots }: { screenshots: { path: string; url: string | null }[] }) {
  if (screenshots.length === 0) return null;
  return (
    <ul className="grid grid-cols-4 gap-snug sm:grid-cols-6">
      {screenshots.map((photo, index) => (
        <li key={photo.path} className="aspect-square overflow-hidden rounded-md border border-border bg-card">
          {photo.url ? (
            <a href={photo.url} target="_blank" rel="noopener noreferrer" aria-label={`Open screenshot ${index + 1} in a new tab`} className="block size-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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

export function ReferencesQueue({
  claims,
  proofs,
  disputes,
}: {
  claims: ReferenceClaimRow[];
  proofs: ReferenceProofRow[];
  disputes: ReferenceDisputeRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const act = (id: string, run: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        setError(result.message ?? 'Something went wrong.');
        return;
      }
      setDone((current) => new Set(current).add(id));
      router.refresh();
    });
  };

  const visibleClaims = claims.filter((row) => !done.has(row.id));
  const visibleProofs = proofs.filter((row) => !done.has(row.id));
  const visibleDisputes = disputes.filter((row) => !done.has(row.id));
  const total = visibleClaims.length + visibleProofs.length + visibleDisputes.length;

  return (
    <section aria-labelledby="references-admin-heading">
      <div className="mb-group flex items-center gap-snug">
        <h3 id="references-admin-heading" className="text-subhead font-semibold">
          References
        </h3>
        <Badge variant={total > 0 ? 'default' : 'secondary'}>{total} to check</Badge>
      </div>
      <p className="mb-group text-body text-muted-foreground">
        Handle claims, proof checks and disputed references. Experiences publish without staff
        review; this queue only verifies claims and screenshots, and settles disputes.
      </p>
      {error ? (
        <p role="alert" className="mb-group rounded-lg bg-destructive/10 px-cozy py-snug text-body text-destructive">
          {error}
        </p>
      ) : null}

      {total === 0 ? (
        <EmptyState title="Nothing to check" titleAs="h4" description="No claims, proofs or disputes are waiting." compact />
      ) : (
        <div className="space-y-group">
          {visibleClaims.map((row) => (
            <Card key={row.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-snug">
                  <Badge>Claim</Badge>
                  <CardTitle className="text-lead">
                    @{row.handle} · {row.platform}
                  </CardTitle>
                  <span className="text-meta text-muted-foreground">
                    by {row.claimantName} · {formatRelativeTime(row.createdAt)}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-cozy">
                <p className="text-body text-muted-foreground">
                  Bio code asked: <span className="font-mono font-medium text-foreground">{row.bioCode}</span>.
                  Check the screenshot shows this code in the {row.platform} bio.
                </p>
                <ScreenshotStrip screenshots={row.screenshots} />
                <div className="flex flex-wrap gap-snug">
                  <Button size="sm" disabled={pending} onClick={() => act(row.id, () => decideHandleClaim(row.id, 'APPROVE'))}>
                    Approve claim
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => act(row.id, () => decideHandleClaim(row.id, 'DECLINE'))}>
                    Decline
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {visibleProofs.map((row) => (
            <Card key={row.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-snug">
                  <Badge variant="secondary">Proof</Badge>
                  <CardTitle className="text-lead">
                    {row.voucherName} for {row.targetName}
                  </CardTitle>
                  <span className="text-meta text-muted-foreground">
                    {row.platform} · {row.role}
                    {row.dateLabel ? ` · ${row.dateLabel}` : ''}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-cozy">
                <ScreenshotStrip screenshots={row.screenshots} />
                <Button size="sm" disabled={pending} onClick={() => act(row.id, () => setReferenceProofChecked(row.id))}>
                  Mark receipt checked
                </Button>
              </CardContent>
            </Card>
          ))}

          {visibleDisputes.map((row) => (
            <Card key={row.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-snug">
                  <Badge variant="destructive">Disputed</Badge>
                  <CardTitle className="text-lead">
                    {row.voucherName} about {row.targetName}
                  </CardTitle>
                  <span className="text-meta text-muted-foreground">
                    {row.sentiment === 'NEGATIVE' ? `Negative · ${row.categoryLabel ?? ''}` : 'Positive'}
                    {row.disputedAt ? ` · disputed ${formatRelativeTime(row.disputedAt)}` : ''}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-cozy">
                {row.comment ? <p className="text-body text-foreground">&ldquo;{row.comment}&rdquo;</p> : null}
                <div className="flex flex-wrap gap-snug">
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => act(row.id, () => resolveReferenceDispute(row.id, 'KEEP'))}>
                    Keep it live
                  </Button>
                  <Button size="sm" variant="destructive" disabled={pending} onClick={() => act(row.id, () => resolveReferenceDispute(row.id, 'REMOVE'))}>
                    Remove reference
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
