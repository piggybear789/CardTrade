'use client';

// components/admin/ReferencesQueue.tsx
//
// The References tab of the Operations console (0155): manual handle claims
// waiting on a screenshot check, reference proofs waiting to become receipt-checked,
// and releasing a handle linked to the wrong member. Nothing here gates publication:
// positive and negative experiences are already live, and an admin takes one down
// from the card itself on the references page ("Remove").

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  decideHandleClaim,
  rejectReferenceProof,
  releaseHandleClaim,
  setReferenceProofChecked,
} from '@/lib/actions/admin';
import { CLAIM_PLATFORMS, platformLabel } from '@/domain/references/reference';
import { formatRelativeTime } from '@/lib/format';

export interface ReferenceClaimRow {
  id: string;
  platform: string;
  handle: string;
  claimantId: string;
  claimantName: string;
  /** What the member wrote about their screenshots. */
  note: string | null;
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
}: {
  claims: ReferenceClaimRow[];
  proofs: ReferenceProofRow[];
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
  const total = visibleClaims.length + visibleProofs.length;

  return (
    <section aria-labelledby="references-admin-heading">
      <div className="mb-group flex items-center gap-snug">
        <h3 id="references-admin-heading" className="text-subhead font-semibold">
          References
        </h3>
        <Badge variant={total > 0 ? 'default' : 'secondary'}>{total} to check</Badge>
      </div>
      <p className="mb-group text-body text-muted-foreground">
        Handle claims and proof checks. Experiences publish without staff review; remove one
        from its card on the references page.
      </p>
      {error ? (
        <p role="alert" className="mb-group rounded-lg bg-destructive/10 px-cozy py-snug text-body text-destructive">
          {error}
        </p>
      ) : null}

      {total === 0 ? (
        <EmptyState title="Nothing to check" titleAs="h4" description="No claims or proofs are waiting." compact />
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
                  Check the screenshots show {row.claimantName} signed in as @{row.handle} on {row.platform}.
                </p>
                {row.note ? <p className="text-body text-foreground">&ldquo;{row.note}&rdquo;</p> : null}
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
                <div className="flex flex-wrap gap-snug">
                  <Button size="sm" disabled={pending} onClick={() => act(row.id, () => setReferenceProofChecked(row.id))}>
                    Mark receipt checked
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => act(row.id, () => rejectReferenceProof(row.id))}>
                    Doesn&rsquo;t show the deal
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ReleaseHandleForm />
    </section>
  );
}

/**
 * Release a handle claimed by the wrong member. Its references go back to the handle and
 * its real owner can claim it; references left for the member directly stay with them.
 */
function ReleaseHandleForm() {
  const router = useRouter();
  const [platform, setPlatform] = useState<string>('instagram');
  const [handle, setHandle] = useState('');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const release = () => {
    setResult(null);
    startTransition(async () => {
      const outcome = await releaseHandleClaim(platform, handle);
      if (!outcome.ok) {
        setResult({ ok: false, text: outcome.message ?? 'Something went wrong.' });
        return;
      }
      setResult({
        ok: true,
        text: `Released @${handle.replace(/^@/, '')}. ${outcome.data.moved} ${outcome.data.moved === 1 ? 'reference' : 'references'} moved back to the handle.`,
      });
      setHandle('');
      router.refresh();
    });
  };

  return (
    <Card className="mt-group">
      <CardHeader>
        <CardTitle className="text-lead">Release a handle</CardTitle>
      </CardHeader>
      <CardContent className="space-y-cozy">
        <p className="text-body text-muted-foreground">
          For a handle linked to the wrong member. The member is told it was unlinked.
        </p>
        <div className="flex flex-col gap-snug sm:flex-row sm:items-end">
          <div className="space-y-tight">
            <Label htmlFor="release-platform">Platform</Label>
            <select
              id="release-platform"
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-card px-3 text-body sm:w-44"
            >
              {CLAIM_PLATFORMS.map((slug) => (
                <option key={slug} value={slug}>
                  {platformLabel(slug)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 space-y-tight">
            <Label htmlFor="release-handle">Handle</Label>
            <Input
              id="release-handle"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="@handle"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <Button variant="outline" disabled={pending || handle.trim().length === 0} onClick={release}>
            {pending ? 'Releasing…' : 'Release handle'}
          </Button>
        </div>
        {result ? (
          <p
            role={result.ok ? 'status' : 'alert'}
            className={result.ok ? 'text-body text-muted-foreground' : 'text-body text-destructive'}
          >
            {result.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
