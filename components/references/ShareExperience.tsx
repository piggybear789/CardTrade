'use client';

// components/references/ShareExperience.tsx
//
// Share your experience (0155): the one action on a reference graph. Two
// branches from a single door:
//   * It went well   — a positive reference. Structured facts only, live
//                      immediately, nobody approves it.
//   * It went badly  — a negative experience. Category plus an optional
//                      comment, ALSO live immediately and public, attached
//                      to the sharer's verified identity.
// Both go through `giveReference`; both need Stage-1 ID verification first
// (no payout/Connect onboarding). The platform and month arrive prefilled
// from wherever the member came from; role is the one real choice.

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, CheckmarkCircle02Icon, Copy01Icon, ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
} from '@/domain/references/reference';
import { cn } from '@/lib/utils';

export interface ShareExperienceViewer {
  signedIn: boolean;
  identityVerified: boolean;
  isSelf: boolean;
}

type Step = 'choose' | 'well' | 'badly' | 'done';

const ROLE_OPTIONS = REFERENCE_ROLES.map((r) => ({ value: r.slug, label: r.label }));

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
  /** Open the chooser on mount (the member arrived from a reference request link). */
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('choose');
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
    if (autoOpen && viewer.signedIn && !viewer.isSelf) setOpen(true);
  }, [autoOpen, viewer.signedIn, viewer.isSelf]);

  // Your own graph: the action is asking, not vouching.
  if (viewer.isSelf) {
    const copyLink = async () => {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${returnPath}?experience=1`);
        setCopied(true);
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
      <div className="shrink-0">
        <div className="flex gap-snug">
          <Button variant="outline" className="shrink-0" onClick={copyLink}>
            <HugeiconsIcon icon={Copy01Icon} className="size-4" aria-hidden />
            {copied ? 'Link copied' : 'Copy your reference link'}
          </Button>
          <Button variant="ghost" className="shrink-0" onClick={toggleQr} aria-expanded={showQr}>
            {showQr ? 'Hide QR' : 'Show QR'}
          </Button>
        </div>
        {showQr && qrUrl ? (
          <div className="mt-snug rounded-xl border border-border bg-card p-cozy text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrUrl} alt="QR code for your reference link" width={180} height={180} className="mx-auto" />
            <p className="mt-tight text-meta text-muted-foreground">
              At a meetup, they scan this and share an experience on the spot.
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  if (!viewer.signedIn) {
    return (
      <Button asChild className="shrink-0">
        <Link href={`/sign-in?redirectTo=${encodeURIComponent(returnPath)}`}>
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

  const submit = (sentiment: 'POSITIVE' | 'NEGATIVE') => {
    setError(null);
    startTransition(async () => {
      const result = await giveReference({
        target:
          target.kind === 'profile'
            ? { kind: 'profile', profileId: target.id }
            : { kind: 'claim', claimId: target.id },
        platform,
        role,
        occurredMonth: month,
        sentiment,
        category: sentiment === 'NEGATIVE' ? category : null,
        comment: sentiment === 'NEGATIVE' ? comment : null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (sentiment === 'POSITIVE' && proofPaths.length > 0) {
        // Best effort: the reference is already live either way; the proof
        // just upgrades it once staff check it.
        await attachReferenceProof(result.data.referenceId, proofPaths).catch(() => null);
      }
      setStep('done');
      router.refresh();
    });
  };

  const gate = !viewer.identityVerified ? (
    <div className="rounded-lg border border-border bg-muted/40 p-cozy">
      <p className="flex items-center gap-tight text-body font-semibold text-foreground">
        <HugeiconsIcon icon={ShieldCheckIcon} className="size-4 text-trust" aria-hidden />
        Verify your ID first
      </p>
      <p className="mt-tight text-body text-muted-foreground">
        Experiences only count from people who passed an ID check. It takes a photo ID and a
        selfie with Stripe, no bank details. Then you&rsquo;ll come back here.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-snug">
        <Link href="/profile?tab=verification">Verify ID</Link>
      </Button>
    </div>
  ) : null;

  return (
    <div className="shrink-0">
      {!open ? (
        <Button className="shrink-0" onClick={() => { setOpen(true); setStep('choose'); }}>
          Share your experience
        </Button>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-group sm:items-center" role="dialog" aria-modal="true" aria-label={`Share your experience with ${target.handle}`}>
          <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card p-group shadow-lg">
            <div className="flex items-start justify-between gap-cozy">
              <div className="min-w-0">
                <h3 className="text-lead font-semibold text-foreground">
                  {step === 'done' ? "It's live" : 'Share your experience'}
                </h3>
                <p className="mt-0.5 truncate text-body text-muted-foreground">
                  {target.handle}
                  {target.name !== target.handle ? ` · ${target.name}` : ''}
                  {target.unclaimed ? ' · Unclaimed' : ''}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden />
              </Button>
            </div>

            {step !== 'done' && gate ? <div className="mt-group">{gate}</div> : null}

            {step === 'choose' && !gate ? (
              <div className="mt-group space-y-snug">
                <button
                  type="button"
                  onClick={() => setStep('well')}
                  className="block w-full rounded-xl border border-border p-cozy text-left transition-colors hover:border-foreground/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block text-body font-semibold text-foreground">It went well</span>
                  <span className="mt-0.5 block text-body text-muted-foreground">
                    Give a reference. Public, live straight away. They don&rsquo;t approve it.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep('badly')}
                  className="block w-full rounded-xl border border-border p-cozy text-left transition-colors hover:border-foreground/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block text-body font-semibold text-foreground">It went badly</span>
                  <span className="mt-0.5 block text-body text-muted-foreground">
                    Share a negative experience. Public, live straight away, with your verified
                    name on it.
                  </span>
                </button>
                <p className="text-center text-meta text-muted-foreground">
                  Only share an experience from a deal you personally completed.
                </p>
              </div>
            ) : null}

            {(step === 'well' || step === 'badly') && !gate ? (
              <div className="mt-group space-y-group">
                <div>
                  <p className="mb-snug text-body font-semibold text-foreground" id="exp-role-label">
                    {step === 'well' ? 'You…' : 'The deal was…'}
                  </p>
                  <div className="space-y-tight" role="group" aria-labelledby="exp-role-label">
                    {ROLE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setRole(option.value)}
                        aria-pressed={role === option.value}
                        className={cn(
                          'block h-11 w-full rounded-lg border px-cozy text-left text-body transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          role === option.value
                            ? 'border-foreground bg-foreground font-semibold text-background'
                            : 'border-border bg-card hover:border-foreground/40',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {step === 'badly' ? (
                  <>
                    <div>
                      <p className="mb-snug text-body font-semibold text-foreground" id="exp-cat-label">
                        What happened?
                      </p>
                      <div className="space-y-tight" role="group" aria-labelledby="exp-cat-label">
                        {NEGATIVE_CATEGORIES.map((option) => (
                          <button
                            key={option.slug}
                            type="button"
                            onClick={() => setCategory(option.slug)}
                            aria-pressed={category === option.slug}
                            className={cn(
                              'block h-11 w-full rounded-lg border px-cozy text-left text-body transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              category === option.slug
                                ? 'border-foreground bg-foreground font-semibold text-background'
                                : 'border-border bg-card hover:border-foreground/40',
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label htmlFor="exp-comment" className="mb-snug block text-body font-semibold text-foreground">
                        Say what happened <span className="font-normal text-muted-foreground">(optional, public)</span>
                      </label>
                      <textarea
                        id="exp-comment"
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                        maxLength={500}
                        rows={3}
                        className="w-full rounded-lg border border-input bg-card px-cozy py-snug text-body text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        placeholder="Keep it to what happened…"
                      />
                    </div>
                  </>
                ) : null}

                {step === 'well' ? (
                  <div>
                    <label htmlFor="exp-proof" className="mb-snug block text-body font-semibold text-foreground">
                      Add a screenshot <span className="font-normal text-muted-foreground">(optional)</span>
                    </label>
                    <Input
                      id="exp-proof"
                      type="file"
                      accept={REFERENCE_IMAGE_ACCEPT}
                      multiple
                      onChange={(event) => onProofFiles(event.target.files)}
                      className="h-11 pt-2"
                    />
                    <p className="mt-tight text-meta text-muted-foreground">
                      {proofNames.length > 0
                        ? proofNames.join(', ')
                        : 'DM, payment or tracking. Only NoDitto staff see it. It earns the Receipt checked mark once they check it.'}
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-x-cozy gap-y-snug text-body text-muted-foreground">
                  <label className="flex items-center gap-tight">
                    Where
                    <select
                      value={platform}
                      onChange={(event) => setPlatform(event.target.value)}
                      className="h-9 rounded-md border border-input bg-card px-tight text-body text-foreground"
                    >
                      {REFERENCE_PLATFORMS.map((p) => (
                        <option key={p.slug} value={p.slug}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-tight">
                    When
                    <input
                      type="month"
                      value={month}
                      max={currentMonth()}
                      onChange={(event) => setMonth(event.target.value)}
                      className="h-9 rounded-md border border-input bg-card px-tight text-body text-foreground"
                    />
                  </label>
                </div>

                {error ? (
                  <p role="alert" className="rounded-lg bg-destructive/10 px-cozy py-snug text-body text-destructive">
                    {error}
                  </p>
                ) : null}

                <Button
                  className="w-full"
                  disabled={pending || uploadingProof}
                  onClick={() => submit(step === 'well' ? 'POSITIVE' : 'NEGATIVE')}
                >
                  {pending
                    ? 'Posting…'
                    : step === 'well'
                      ? 'Post reference'
                      : 'Post experience'}
                </Button>
                <button
                  type="button"
                  onClick={() => setStep(step === 'well' ? 'badly' : 'well')}
                  className="w-full text-center text-body text-muted-foreground underline-offset-4 hover:underline"
                >
                  {step === 'well'
                    ? 'Deal went badly? Share a negative experience instead'
                    : 'Actually, it went well? Give a reference instead'}
                </button>
              </div>
            ) : null}

            {step === 'done' ? (
              <div className="mt-group space-y-group text-center">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} className="mx-auto size-10 text-trust" aria-hidden />
                <p className="text-body text-muted-foreground">
                  Your experience is on {target.handle}&rsquo;s graph now, with your verified name
                  on it. They&rsquo;ve been notified.
                </p>
                <Button
                  className="w-full"
                  onClick={() => {
                    setOpen(false);
                    setStep('choose');
                  }}
                >
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
