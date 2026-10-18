'use client';

// components/references/ShareExperience.tsx
//
// Share your experience (0155): unified Apple/SaaS-style composer modal.
//   * Side-by-side Positive / Negative sentiment toggle
//   * Side-by-side Bought / Sold / Traded segmented control
//   * Text input below to share the experience in words
//   * Platform pills so deals across Instagram, Facebook, Discord, eBay,
//     Whatnot, and In-person synthesise into one cross-platform graph.

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  ImageAdd01Icon,
  ShieldCheckIcon,
} from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import {
  attachReferenceProof,
  giveReference,
  type ReferenceTargetDescriptor,
} from '@/lib/actions/references';
import { uploadReferenceImage } from '@/lib/storage/uploadReferenceImage';
import { REFERENCE_IMAGE_ACCEPT } from '@/lib/storage/referenceImagesShared';
import {
  NEGATIVE_CATEGORIES,
  REFERENCE_PLATFORMS,
  REFERENCE_ROLES,
  type ReferenceSentiment,
} from '@/domain/references/reference';
import { cn } from '@/lib/utils';

export interface ShareExperienceViewer {
  signedIn: boolean;
  identityVerified: boolean;
  isSelf: boolean;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function ShareExperience({
  target,
  viewer,
  returnPath,
  autoOpen = false,
}: {
  target: ReferenceTargetDescriptor;
  viewer: ShareExperienceViewer;
  /** Where sign-in / verification should bring the member back to. */
  returnPath: string;
  /** Open the composer on mount (arrived from a reference request link). */
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [sentiment, setSentiment] = useState<ReferenceSentiment>('POSITIVE');
  const [role, setRole] = useState<string>('BOUGHT');
  const [category, setCategory] = useState<string>('NEVER_ARRIVED');
  const [comment, setComment] = useState('');
  const [platform, setPlatform] = useState(
    REFERENCE_PLATFORMS.some((p) => p.slug === target.platform) ? target.platform : 'instagram',
  );
  const [month, setMonth] = useState(currentMonth());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [proofPaths, setProofPaths] = useState<string[]>([]);
  const [proofNames, setProofNames] = useState<string[]>([]);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (autoOpen && viewer.signedIn && !viewer.isSelf) {
      setOpen(true);
      setDone(false);
    }
  }, [autoOpen, viewer.signedIn, viewer.isSelf]);

  // Owner viewing their own graph: share / QR controls.
  if (viewer.isSelf) {
    const copyLink = async () => {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${returnPath}?experience=1`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setCopied(false);
      }
    };
    const toggleQr = async () => {
      if (!qrUrl) {
        const QRCode = (await import('qrcode')).default;
        setQrUrl(
          await QRCode.toDataURL(`${window.location.origin}${returnPath}?experience=1`, {
            width: 220,
            margin: 1,
          }),
        );
      }
      setShowQr((current) => !current);
    };
    return (
      <div className="relative shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 rounded-full px-3.5" onClick={copyLink}>
            <HugeiconsIcon icon={Copy01Icon} className="size-3.5" aria-hidden />
            {copied ? 'Copied link' : 'Share reference link'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-full px-3"
            onClick={toggleQr}
            aria-expanded={showQr}
          >
            {showQr ? 'Hide QR' : 'QR'}
          </Button>
        </div>
        {showQr && qrUrl ? (
          <div className="absolute right-0 top-11 z-30 w-56 rounded-2xl border border-border bg-card p-4 text-center shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrUrl}
              alt="QR code for your reference link"
              width={168}
              height={168}
              className="mx-auto rounded-lg"
            />
            <p className="mt-2 text-meta text-muted-foreground">
              Scan at a show or meetup to leave a reference.
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  if (!viewer.signedIn) {
    return (
      <Button asChild size="sm" className="h-9 shrink-0 rounded-full px-4 font-medium shadow-xs">
        <Link href={`/sign-in?redirectTo=${encodeURIComponent(`${returnPath}?experience=1`)}`}>
          Share your experience
        </Link>
      </Button>
    );
  }

  const onProofFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingProof(true);
    setError(null);
    const nextPaths: string[] = [];
    const nextNames: string[] = [];
    for (const file of Array.from(files).slice(0, 3)) {
      const result = await uploadReferenceImage('proof', file);
      if (!result.ok) {
        setError(result.message);
        break;
      }
      nextPaths.push(result.path);
      nextNames.push(file.name);
    }
    setProofPaths(nextPaths);
    setProofNames(nextNames);
    setUploadingProof(false);
  };

  const resolveTargetPayload = () => {
    if (target.kind === 'profile') {
      return { kind: 'profile' as const, profileId: target.id };
    }
    if (target.kind === 'claim') {
      return { kind: 'claim' as const, claimId: target.id };
    }
    return {
      kind: 'handle' as const,
      handle: (target.handleSlug ?? target.handle).replace(/^@/, ''),
    };
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await giveReference({
        target: resolveTargetPayload(),
        platform,
        role,
        occurredMonth: month,
        sentiment,
        category: sentiment === 'NEGATIVE' ? category : null,
        comment,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (sentiment === 'POSITIVE' && proofPaths.length > 0) {
        await attachReferenceProof(result.data.referenceId, proofPaths).catch(() => null);
      }
      setDone(true);
      router.refresh();
    });
  };

  const resetAndClose = () => {
    setOpen(false);
    setDone(false);
    setError(null);
  };

  return (
    <div className="shrink-0">
      <Button
        size="sm"
        className="h-9 shrink-0 rounded-full px-4 font-medium shadow-xs"
        onClick={() => {
          setOpen(true);
          setDone(false);
          setError(null);
        }}
      >
        Share your experience
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 backdrop-blur-[2px] sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={`Share your experience with ${target.handle}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) resetAndClose();
          }}
        >
          <div className="max-h-[92dvh] w-full max-w-[460px] overflow-y-auto rounded-2xl border border-border/80 bg-card p-6 shadow-xl">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[1.125rem] font-semibold tracking-tight text-foreground">
                  {done ? 'Experience published' : 'Share your experience'}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground">
                  <span className="font-medium text-foreground/90">{target.handle}</span>
                  {target.name && target.name !== target.handle.replace(/^@/, '') ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>{target.name}</span>
                    </>
                  ) : null}
                  {target.identityVerified ? (
                    <span className="inline-flex items-center gap-1 font-medium text-trust">
                      <span aria-hidden>·</span>
                      <HugeiconsIcon icon={ShieldCheckIcon} className="size-3.5" aria-hidden />
                      ID verified
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={resetAndClose}
                aria-label="Close"
                className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden />
              </button>
            </div>

            {!viewer.identityVerified && !done ? (
              <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
                <p className="flex items-center gap-2 text-body font-semibold text-foreground">
                  <HugeiconsIcon icon={ShieldCheckIcon} className="size-4 text-trust" aria-hidden />
                  Verify your ID first
                </p>
                <p className="mt-1.5 text-body text-muted-foreground">
                  Every reference is backed by a Stripe photo ID and selfie check. No bank or payout
                  details are required.
                </p>
                <Button asChild size="sm" className="mt-3 rounded-lg">
                  <Link href="/profile?tab=verification">Verify ID with Stripe</Link>
                </Button>
              </div>
            ) : null}

            {viewer.identityVerified && !done ? (
              <div className="mt-5 space-y-4">
                {/* 1. Positive / Negative side-by-side toggle */}
                <div>
                  <label className="mb-1.5 block text-meta font-medium text-muted-foreground">
                    Outcome
                  </label>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Outcome">
                    <button
                      type="button"
                      onClick={() => setSentiment('POSITIVE')}
                      aria-pressed={sentiment === 'POSITIVE'}
                      className={cn(
                        'flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-body font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        sentiment === 'POSITIVE'
                          ? 'border-trust bg-trust/10 font-semibold text-trust ring-1 ring-trust/25'
                          : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                      )}
                    >
                      <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" aria-hidden />
                      Positive
                    </button>
                    <button
                      type="button"
                      onClick={() => setSentiment('NEGATIVE')}
                      aria-pressed={sentiment === 'NEGATIVE'}
                      className={cn(
                        'flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-body font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        sentiment === 'NEGATIVE'
                          ? 'border-destructive bg-destructive/10 font-semibold text-destructive ring-1 ring-destructive/25'
                          : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                      )}
                    >
                      <HugeiconsIcon icon={AlertCircleIcon} className="size-4" aria-hidden />
                      Negative
                    </button>
                  </div>
                </div>

                {/* 2. Bought / Sold / Traded side-by-side segmented control */}
                <div>
                  <label className="mb-1.5 block text-meta font-medium text-muted-foreground">
                    Your role in the deal
                  </label>
                  <div
                    className="grid grid-cols-3 gap-1 rounded-xl border border-border/80 bg-muted/60 p-1"
                    role="group"
                    aria-label="Your role in the deal"
                  >
                    {REFERENCE_ROLES.map((item) => {
                      const active = role === item.slug;
                      return (
                        <button
                          key={item.slug}
                          type="button"
                          onClick={() => setRole(item.slug)}
                          aria-pressed={active}
                          className={cn(
                            'h-9 rounded-lg text-body transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            active
                              ? 'bg-card font-semibold text-foreground shadow-xs'
                              : 'font-medium text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {item.shortLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Optional negative issue tag row when Negative is selected */}
                {sentiment === 'NEGATIVE' ? (
                  <div>
                    <label className="mb-1.5 block text-meta font-medium text-muted-foreground">
                      What went wrong
                    </label>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="What went wrong">
                      {NEGATIVE_CATEGORIES.map((item) => {
                        const active = category === item.slug;
                        return (
                          <button
                            key={item.slug}
                            type="button"
                            onClick={() => setCategory(item.slug)}
                            aria-pressed={active}
                            className={cn(
                              'h-7 rounded-full border px-2.5 text-meta transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              active
                                ? 'border-destructive bg-destructive text-destructive-foreground font-medium'
                                : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                            )}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* 3. Experience in words (Textarea below) */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="exp-comment" className="text-meta font-medium text-muted-foreground">
                      Your experience
                    </label>
                    <span className="text-meta tabular-nums text-muted-foreground/70">
                      {comment.length}/500
                    </span>
                  </div>
                  <textarea
                    id="exp-comment"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder={
                      sentiment === 'POSITIVE'
                        ? 'Share how the deal went (packaging, speed, communication, item condition)...'
                        : 'Share what happened during the deal...'
                    }
                    className="w-full resize-none rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 text-body text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-foreground/40 focus:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                {/* 4. Platform synthesis pills */}
                <div>
                  <label className="mb-1.5 block text-meta font-medium text-muted-foreground">
                    Platform where you dealt
                  </label>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Platform">
                    {REFERENCE_PLATFORMS.map((p) => {
                      const active = platform === p.slug;
                      return (
                        <button
                          key={p.slug}
                          type="button"
                          onClick={() => setPlatform(p.slug)}
                          aria-pressed={active}
                          className={cn(
                            'h-7 rounded-full border px-2.5 text-meta transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            active
                              ? 'border-foreground bg-foreground font-medium text-background'
                              : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                          )}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 5. Compact When + Proof attachment row */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <label className="inline-flex items-center gap-2 text-meta text-muted-foreground">
                    <span>Month</span>
                    <input
                      type="month"
                      value={month}
                      max={currentMonth()}
                      onChange={(event) => setMonth(event.target.value)}
                      className="h-8 rounded-lg border border-border bg-card px-2.5 text-meta text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>

                  {sentiment === 'POSITIVE' ? (
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={REFERENCE_IMAGE_ACCEPT}
                        multiple
                        onChange={(event) => onProofFiles(event.target.files)}
                        className="sr-only"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingProof}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 text-meta font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                      >
                        <HugeiconsIcon icon={ImageAdd01Icon} className="size-3.5" aria-hidden />
                        {uploadingProof
                          ? 'Uploading...'
                          : proofNames.length > 0
                            ? `${proofNames.length} screenshot${proofNames.length === 1 ? '' : 's'} attached`
                            : 'Attach receipt (optional)'}
                      </button>
                    </div>
                  ) : null}
                </div>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-xl border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-body text-destructive"
                  >
                    {error}
                  </p>
                ) : null}

                {/* Footer buttons */}
                <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-4">
                  <Button variant="ghost" size="sm" onClick={resetAndClose} className="rounded-lg">
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={pending || uploadingProof}
                    onClick={submit}
                    className="rounded-lg px-5"
                  >
                    {pending ? 'Publishing...' : 'Publish experience'}
                  </Button>
                </div>
              </div>
            ) : null}

            {done ? (
              <div className="mt-6 space-y-4 text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-full bg-trust/10 text-trust">
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-6" aria-hidden />
                </div>
                <div className="space-y-1">
                  <p className="text-body font-medium text-foreground">
                    Added to {target.handle}&rsquo;s trust graph
                  </p>
                  <p className="text-body text-muted-foreground">
                    Your experience is live across their network with your verified identity.
                  </p>
                </div>
                <Button className="w-full rounded-xl" onClick={resetAndClose}>
                  Done
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
