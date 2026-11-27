'use client';

// components/references/ProofChallengeClient.tsx
//
// Live Proof-of-Card verification page (`/references/verify/[token]`, 0171).
// - When PENDING: shows the one-time handwritten code and opens the rear camera
//   (`capture="environment"`) so the seller can prove live physical possession in 10s,
//   while polling automatically if the buyer has the tab open.
// - When SUBMITTED: displays the signed proof photo, submission timestamp, EXIF
//   presence, and AI Vision sanity check (when configured).

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Icon } from '@/components/ui/icon';
import {
  CameraPlusIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  ClockIcon,
  CopyIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
} from '@/components/ui/icons';

import { Button } from '@/components/ui/button';
import type { ProofChallengeView } from '@/lib/enrichment/proofChallenge';
import { cn } from '@/lib/utils';

export function ProofChallengeClient({ initial }: { initial: ProofChallengeView }) {
  const [challenge, setChallenge] = useState<ProofChallengeView>(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  // Poll every 4s while PENDING so a buyer keeping the link open sees submission live.
  useEffect(() => {
    if (challenge.status !== 'PENDING') return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const res = await fetch(
          `/api/references/proof-challenge/${encodeURIComponent(challenge.token)}`,
          { cache: 'no-store' },
        );
        if (!res.ok || cancelled) return;
        const next = (await res.json()) as ProofChallengeView;
        if (!cancelled) setChallenge(next);
      } catch {
        // retry next tick
      }
    }, 4_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [challenge.status, challenge.token]);

  const submitPhoto = async (file: File | null | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      const res = await fetch(
        `/api/references/proof-challenge/${encodeURIComponent(challenge.token)}`,
        { method: 'POST', body: form },
      );
      const data = (await res.json().catch(() => null)) as
        | ProofChallengeView
        | { error?: string }
        | null;
      if (!res.ok || !data || !('token' in data)) {
        setError(
          data && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Could not upload proof photo.',
        );
        return;
      }
      setChallenge(data);
      toast.success('Proof photo submitted!');
    } catch {
      setError('Network error while uploading photo. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const copyShareLink = async () => {
    if (typeof window === 'undefined') return;
    const msg = `Hey — before I send payment for ${challenge.itemDescription}, could you take a quick 10-second live photo with code ${challenge.code} here? ${window.location.href}`;
    try {
      await navigator.clipboard.writeText(msg);
      toast.success('Copied proof link & message');
    } catch {
      toast.error('Could not copy link');
    }
  };

  return (
    <div className="space-y-group">
      {/* Header card */}
      <header className="ref-surface ref-rise rounded-xl bg-card p-group sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 text-meta font-semibold',
                challenge.status === 'SUBMITTED'
                  ? 'bg-trust/10 text-trust'
                  : challenge.status === 'EXPIRED'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-action/35 text-action-foreground',
              )}
            >
              <Icon
                icon={
                  challenge.status === 'SUBMITTED'
                    ? ShieldCheckIcon
                    : challenge.status === 'EXPIRED'
                      ? ShieldWarningIcon
                      : ClockIcon
                }
                className="size-3.5"
                aria-hidden
              />
              {challenge.status === 'SUBMITTED'
                ? 'Proof photo submitted'
                : challenge.status === 'EXPIRED'
                  ? 'Challenge expired'
                  : 'Waiting for seller proof photo'}
            </span>
            <h1 className="text-subhead font-semibold tracking-tight text-foreground md:text-head">
              Live Proof-of-Card Check
            </h1>
            <p className="text-meta text-muted-foreground">
              Requested for <strong className="text-foreground">{challenge.targetLabel}</strong> ·{' '}
              <strong className="text-foreground">{challenge.itemDescription}</strong>
              {challenge.psaCertNumber ? ` (PSA #${challenge.psaCertNumber})` : ''}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void copyShareLink()}>
            <Icon icon={CopyIcon} className="size-3.5" aria-hidden />
            Copy link for seller
          </Button>
        </div>
      </header>

      {/* Body */}
      {challenge.status === 'PENDING' ? (
        <section className="ref-surface ref-rise space-y-5 rounded-xl bg-card p-group [--ref-step:1] sm:p-6">
          <div className="rounded-xl border border-border bg-muted/25 p-5 text-center">
            <p className="text-meta font-semibold uppercase tracking-wider text-muted-foreground">
              Write this one-time code on paper next to the card
            </p>
            <p className="mt-2 font-mono text-3xl font-bold tracking-widest text-foreground sm:text-4xl">
              {challenge.code}
            </p>
            <p className="mt-2 text-meta text-muted-foreground">
              Place the handwritten code physically beside{' '}
              <strong className="text-foreground">{challenge.itemDescription}</strong>
              {challenge.psaCertNumber ? ` showing PSA cert #${challenge.psaCertNumber}` : ''} and
              take a live photo.
            </p>
          </div>

          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              void submitPhoto(f);
            }}
          />

          {error ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-meta text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col items-center gap-3">
            <Button
              type="button"
              size="lg"
              disabled={uploading}
              onClick={() => cameraRef.current?.click()}
              className="w-full sm:w-auto"
            >
              <Icon
                icon={uploading ? CircleNotchIcon : CameraPlusIcon}
                className={cn('size-4', uploading && 'animate-spin')}
                aria-hidden
              />
              {uploading ? 'Uploading & verifying…' : 'Take live proof photo'}
            </Button>
            <p className="text-center text-[12px] text-muted-foreground">
              Expires {new Date(challenge.expiresAt).toLocaleString('en-AU')} · If you are the buyer,
              keep this page open — it updates automatically when the seller submits.
            </p>
          </div>
        </section>
      ) : challenge.status === 'SUBMITTED' ? (
        <section className="ref-surface ref-rise space-y-4 rounded-xl bg-card p-group [--ref-step:1] sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-body font-semibold text-foreground">
              <Icon icon={CheckCircleIcon} className="size-5 text-trust" aria-hidden />
              <span>Submitted photo for code {challenge.code}</span>
            </div>
            {challenge.submittedAt ? (
              <span className="text-meta text-muted-foreground">
                Uploaded {new Date(challenge.submittedAt).toLocaleString('en-AU')}
              </span>
            ) : null}
          </div>

          {challenge.photoUrl ? (
            <div className="overflow-hidden rounded-xl border border-border bg-muted/20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={challenge.photoUrl}
                alt={`Proof photo for ${challenge.itemDescription} with code ${challenge.code}`}
                className="mx-auto max-h-[540px] w-full object-contain"
              />
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-muted/20 p-3.5 text-meta">
              <p className="font-semibold text-foreground">Capture Forensics</p>
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                <li>
                  Camera EXIF metadata:{' '}
                  <strong className="text-foreground">
                    {challenge.captureMetadata.hasExif ? 'Present (camera capture)' : 'Stripped / absent'}
                  </strong>
                </li>
                {challenge.captureMetadata.width && challenge.captureMetadata.height ? (
                  <li>
                    Resolution:{' '}
                    <strong className="text-foreground">
                      {challenge.captureMetadata.width} × {challenge.captureMetadata.height}
                    </strong>
                  </li>
                ) : null}
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-3.5 text-meta">
              <p className="font-semibold text-foreground">Buyer Checklist</p>
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                <li>
                  1. Verify handwritten <strong className="font-mono text-foreground">{challenge.code}</strong> sits naturally on paper (not digitally pasted).
                </li>
                <li>
                  2. Confirm the card/slab matches <strong className="text-foreground">{challenge.itemDescription}</strong>
                  {challenge.psaCertNumber ? ` (#${challenge.psaCertNumber})` : ''}.
                </li>
                {challenge.aiVerdict ? (
                  <li>
                    AI sanity check:{' '}
                    <strong className="text-foreground">
                      {challenge.aiVerdict.codeVisible && challenge.aiVerdict.cardVisible && challenge.aiVerdict.appearsLivePhoto
                        ? 'Code & card visible in live photo'
                        : challenge.aiVerdict.notes || 'Review photo closely'}
                    </strong>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </section>
      ) : (
        <section className="ref-surface ref-rise rounded-xl bg-card p-6 text-center [--ref-step:1]">
          <p className="text-body font-semibold text-foreground">This proof challenge has expired.</p>
          <p className="mt-1 text-meta text-muted-foreground">
            Run a new background check to generate a fresh 1-time Proof-of-Card link.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href="/references">Back to references</Link>
          </Button>
        </section>
      )}
    </div>
  );
}
