'use client';

// components/references/ReferenceComposer.tsx
//
// Leaving a reference (0155), built on our standard UI primitives (`StarIcon`
// 1..5 rating, `Label`, `Textarea`, `Button`, `PendingLabel`).

import {
  createContext,
  use,
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Cancel01Icon,
  Copy01Icon,
  ImageAdd01Icon,
  ShieldCheckIcon,
  StarIcon,
} from '@hugeicons/core-free-icons';

import { SocialPlatformIcon } from '@/components/profile/SocialPlatformIcon';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { OptionButton } from '@/components/ui/option-button';
import { PendingLabel } from '@/components/ui/pending-label';
import { Textarea } from '@/components/ui/textarea';
import { attachReferenceProof, giveReference, type ReferenceTargetDescriptor } from '@/lib/actions/references';
import { uploadReferenceImage } from '@/lib/storage/uploadReferenceImage';
import { REFERENCE_IMAGE_ACCEPT } from '@/lib/storage/referenceImagesShared';
import {
  REFERENCE_PLATFORMS,
  REFERENCE_ROLES,
  REFERENCE_SENTIMENTS,
  isReferenceRole,
  type ReferenceRole,
  type ReferenceSentiment,
} from '@/domain/references/reference';
import { cn } from '@/lib/utils';

const COMMENT_LIMIT = 500;
const PROOF_LIMIT = 3;

/** Who is looking, as far as leaving a reference goes. */
export interface ComposerViewer {
  signedIn: boolean;
  identityVerified: boolean;
  /** Looking at their own page, where they ask for references rather than leave one. */
  isSelf: boolean;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function targetPayload(target: ReferenceTargetDescriptor) {
  if (target.kind === 'profile') return { kind: 'profile' as const, profileId: target.id };
  if (target.kind === 'claim') return { kind: 'claim' as const, claimId: target.id };
  return { kind: 'handle' as const, handle: (target.handleSlug ?? target.handle).replace(/^@/, '') };
}

function sentimentForRating(rating: number): ReferenceSentiment {
  if (rating <= 2) return 'NEGATIVE';
  if (rating === 3) return 'NEUTRAL';
  return 'POSITIVE';
}

/** The draft reference and what can be done with it. */
export function useReferenceComposer(target: ReferenceTargetDescriptor) {
  const router = useRouter();
  const storageKey = `noditto:ref-draft:${(target.handleSlug ?? target.handle).replace(/^@/, '').toLowerCase()}`;
  const [platform, setPlatformState] = useState<string>('');
  const [role, setRole] = useState<ReferenceRole>('BOUGHT');
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState('');
  const [proofPaths, setProofPaths] = useState<string[]>([]);
  const [proofNames, setProofNames] = useState<string[]>([]);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const setPlatform = (next: string) => {
    setPlatformState(next);
    setError(null);
  };

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { platform?: string; role?: string; rating?: number; comment?: string };
      if (isReferenceRole(parsed.role)) {
        setRole(parsed.role);
      }
      if (
        typeof parsed.platform === 'string' &&
        REFERENCE_PLATFORMS.some((p) => p.slug === parsed.platform)
      ) {
        setPlatformState(parsed.platform);
      }
      if (typeof parsed.rating === 'number' && parsed.rating >= 1 && parsed.rating <= 5) {
        setRating(parsed.rating);
      }
      if (typeof parsed.comment === 'string') {
        setComment(parsed.comment);
      }
    } catch {
      // ignore storage errors
    }
  }, [storageKey]);

  const saveDraftToSession = (): boolean => {
    if (!platform) {
      setError('Select which platform this account is on.');
      return false;
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ platform, role, rating, comment }));
    } catch {
      // ignore storage errors
    }
    return true;
  };

  const sentiment = sentimentForRating(rating);

  /** Step 1's gate in the stepped dialog: a platform must be chosen before moving on. */
  const requirePlatform = (): boolean => {
    if (platform) return true;
    setError('Select which platform this account is on.');
    return false;
  };

  const attachProof = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingProof(true);
    setError(null);
    const paths = [...proofPaths];
    const names = [...proofNames];
    for (const file of Array.from(files).slice(0, PROOF_LIMIT - paths.length)) {
      const result = await uploadReferenceImage('proof', file);
      if (!result.ok) {
        setError(result.message);
        break;
      }
      paths.push(result.path);
      names.push(file.name);
    }
    setProofPaths(paths);
    setProofNames(names);
    setUploadingProof(false);
  };

  const removeProof = (index: number) => {
    setProofPaths((prev) => prev.filter((_, i) => i !== index));
    setProofNames((prev) => prev.filter((_, i) => i !== index));
  };

  const publish = () => {
    if (!platform) {
      setError('Select which platform this account is on.');
      return;
    }
    if (rating < 1 || rating > 5) {
      setError('Pick a rating from 1 to 5.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await giveReference({
        target: targetPayload(target),
        platform,
        role,
        occurredMonth: currentMonth(),
        rating,
        sentiment,
        category: sentiment === 'NEGATIVE' ? 'OTHER' : null,
        comment,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (proofPaths.length > 0) {
        await attachReferenceProof(result.data.referenceId, proofPaths).catch(() => null);
      }
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
      setDone(true);
      router.refresh();
    });
  };

  /** Back to an empty draft, as after publishing or cancelling. */
  const reset = () => {
    setDone(false);
    setError(null);
    setPlatformState('');
    setRole('BOUGHT');
    setRating(5);
    setComment('');
    setProofPaths([]);
    setProofNames([]);
  };

  return {
    target,
    platform,
    setPlatform,
    role,
    setRole,
    rating,
    setRating,
    sentiment,
    comment,
    setComment,
    proofNames,
    uploadingProof,
    attachProof,
    removeProof,
    error,
    done,
    pending,
    publish,
    reset,
    saveDraftToSession,
    requirePlatform,
  };
}

export type ReferenceDraft = ReturnType<typeof useReferenceComposer>;

const ComposerContext = createContext<ReferenceDraft | null>(null);

function useDraft(): ReferenceDraft {
  const draft = use(ComposerContext);
  if (!draft) throw new Error('Reference composer fields must sit inside <Composer.Provider>.');
  return draft;
}

function Provider({ draft, children }: { draft: ReferenceDraft; children: ReactNode }) {
  return <ComposerContext value={draft}>{children}</ComposerContext>;
}

/** The words a rating is published under, from the domain's one list. */
const SENTIMENT_LABEL = Object.fromEntries(
  REFERENCE_SENTIMENTS.map((s) => [s.slug, s.label]),
) as Record<ReferenceSentiment, string>;

const PLATFORM_ICON_TINT: Record<string, string> = {
  instagram: 'text-[#E1306C]',
  facebook: 'text-[#1877F2]',
  discord: 'text-[#5865F2]',
  ebay: 'text-[#E53238]',
  whatnot: 'text-foreground',
  other: 'text-muted-foreground',
};

function Platform() {
  const { platform, setPlatform } = useDraft();

  return (
    <div className="space-y-snug">
      <Label>Platform</Label>
      <div
        role="radiogroup"
        aria-label="Platform"
        className="grid grid-cols-2 gap-snug sm:grid-cols-3"
      >
        {REFERENCE_PLATFORMS.map((p) => {
          const selected = platform === p.slug;
          return (
            <OptionButton key={p.slug} selected={selected} onClick={() => setPlatform(p.slug)}>
              <SocialPlatformIcon
                slug={p.slug}
                className={cn(
                  p.slug === 'ebay' || p.slug === 'whatnot' ? 'size-4' : 'size-3.5',
                  PLATFORM_ICON_TINT[p.slug] ?? 'text-muted-foreground',
                )}
              />
              <span className="truncate">{p.label}</span>
            </OptionButton>
          );
        })}
      </div>
    </div>
  );
}

/** Whether the voucher bought from, sold to, or traded with the person. */
function Role() {
  const { role, setRole } = useDraft();

  return (
    <div className="space-y-snug">
      <Label>Deal</Label>
      <div role="radiogroup" aria-label="Deal" className="grid grid-cols-3 gap-snug">
        {REFERENCE_ROLES.map((r) => {
          const selected = role === r.slug;
          return (
            <OptionButton
              key={r.slug}
              selected={selected}
              aria-label={r.label}
              onClick={() => setRole(r.slug)}
              className="justify-center"
            >
              <span className="truncate">{r.shortLabel}</span>
            </OptionButton>
          );
        })}
      </div>
    </div>
  );
}

function Outcome() {
  const { rating, setRating } = useDraft();
  const [hover, setHover] = useState(0);
  const active = hover || rating;

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      setRating(Math.min(5, (rating || 0) + 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      setRating(Math.max(1, (rating || 1) - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setRating(1);
    } else if (e.key === 'End') {
      e.preventDefault();
      setRating(5);
    }
  }

  return (
    <div className="space-y-snug">
      <div className="flex items-center justify-between">
        <Label>Rating</Label>
        {/* What the stars will be published as, so a 3 is not a surprise "So-so". */}
        <span className="text-meta text-muted-foreground" aria-live="polite">
          {SENTIMENT_LABEL[sentimentForRating(active || rating)]}
        </span>
      </div>
      <div
        className="flex items-center gap-tight"
        role="radiogroup"
        aria-label="Star rating"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} star${value === 1 ? '' : 's'}`}
            onClick={() => setRating(value)}
            onMouseEnter={() => setHover(value)}
            onMouseLeave={() => setHover(0)}
            className="touch-manipulation rounded border border-transparent p-tight focus:outline-none focus-visible:border-ring"
          >
            <HugeiconsIcon
              icon={StarIcon}
              className={cn(
                'size-7 transition-colors',
                value <= active ? 'fill-iris text-iris-ink' : 'text-muted-foreground/40',
              )}
              aria-hidden
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function Comment({ id, rows = 4, autoFocus = false }: { id: string; rows?: number; autoFocus?: boolean }) {
  const { comment, setComment } = useDraft();

  return (
    <div className="space-y-snug">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>Description</Label>
        <span className="text-meta tabular-nums text-muted-foreground">
          {comment.length}/{COMMENT_LIMIT}
        </span>
      </div>
      <Textarea
        id={id}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        maxLength={COMMENT_LIMIT}
        rows={rows}
        autoFocus={autoFocus}
        placeholder="How was your experience?"
        className="resize-none"
      />
    </div>
  );
}

function ImageField() {
  const { proofNames, uploadingProof, attachProof, removeProof } = useDraft();
  const fileInput = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-snug">
      <input
        ref={fileInput}
        type="file"
        accept={REFERENCE_IMAGE_ACCEPT}
        multiple
        onChange={(event) => {
          void attachProof(event.target.files);
          event.target.value = '';
        }}
        className="sr-only"
      />
      <div className="flex items-center justify-between">
        <Label>Screenshots</Label>
        <span className="text-meta text-muted-foreground">Optional</span>
      </div>
      <p className="text-meta text-muted-foreground">
        Proof of the deal, such as a payment or chat. Only our team sees these.
      </p>
      <div className="flex flex-wrap items-center gap-snug">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploadingProof || proofNames.length >= PROOF_LIMIT}
          onClick={() => fileInput.current?.click()}
        >
          <HugeiconsIcon icon={ImageAdd01Icon} aria-hidden />
          {uploadingProof
            ? 'Uploading…'
            : proofNames.length > 0
              ? `Add image (${proofNames.length}/${PROOF_LIMIT})`
              : 'Add image'}
        </Button>

        {proofNames.map((name, index) => (
          <span
            key={`${name}-${index}`}
            className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-meta text-foreground"
          >
            <span className="truncate">{name}</span>
            <button
              type="button"
              onClick={() => removeProof(index)}
              aria-label={`Remove ${name}`}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-3" aria-hidden />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function ErrorNotice() {
  const { error } = useDraft();
  if (!error) return null;
  return (
    <p role="alert" className="text-body text-destructive">
      {error}
    </p>
  );
}

function Publish({ className }: { className?: string }) {
  const { pending, uploadingProof, publish } = useDraft();
  return (
    <Button
      type="button"
      disabled={pending || uploadingProof}
      aria-busy={pending}
      onClick={publish}
      className={className}
    >
      <PendingLabel pending={pending} pendingLabel="Publishing…">
        Publish reference
      </PendingLabel>
    </Button>
  );
}

/**
 * The draft read back before it is published. A reference goes live the moment it is
 * published and carries the author's verified name, so the last step shows exactly what
 * other traders will see. Each row's Edit jumps to the step that owns it.
 */
function Summary({ onEdit }: { onEdit: (step: number) => void }) {
  const { target, platform, role, rating, sentiment, comment } = useDraft();
  const platformLabel = REFERENCE_PLATFORMS.find((p) => p.slug === platform)?.label ?? '—';
  const roleText = REFERENCE_ROLES.find((r) => r.slug === role)?.label ?? role;

  const rows: Array<{ label: string; value: ReactNode; step: number }> = [
    {
      label: 'Deal',
      value: (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {platform ? (
            <SocialPlatformIcon
              slug={platform}
              className={cn('size-3.5 shrink-0', PLATFORM_ICON_TINT[platform] ?? 'text-muted-foreground')}
            />
          ) : null}
          <span className="truncate">
            {roleText} on {platformLabel}
          </span>
        </span>
      ),
      step: 1,
    },
    {
      label: 'Rating',
      value: (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex" aria-label={`${rating} out of 5 stars`}>
            {[1, 2, 3, 4, 5].map((value) => (
              <HugeiconsIcon
                key={value}
                icon={StarIcon}
                className={cn(
                  'size-3.5',
                  value <= rating ? 'fill-iris text-iris-ink' : 'text-muted-foreground/40',
                )}
                aria-hidden
              />
            ))}
          </span>
          <span className="text-muted-foreground">{SENTIMENT_LABEL[sentiment]}</span>
        </span>
      ),
      step: 2,
    },
    {
      label: 'Description',
      value: comment.trim() ? (
        <span className="line-clamp-3 whitespace-pre-line">{comment.trim()}</span>
      ) : (
        <span className="text-muted-foreground">None</span>
      ),
      step: 2,
    },
  ];

  return (
    <div className="space-y-snug">
      <dl className="divide-y divide-border rounded-lg bg-muted/50">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start gap-cozy px-cozy py-2.5">
            <dt className="w-24 shrink-0 text-meta text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 flex-1 text-body text-foreground">{row.value}</dd>
            <button
              type="button"
              onClick={() => onEdit(row.step)}
              aria-label={`Edit ${row.label.toLowerCase()}`}
              className="shrink-0 rounded-sm text-meta font-medium text-iris-ink hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Edit
            </button>
          </div>
        ))}
      </dl>
      <p className="text-meta text-muted-foreground">
        It goes live on {target.handle}&rsquo;s page straight away, with your verified name.
      </p>
    </div>
  );
}

/** What follows a published reference. */
function Published({ onDone }: { onDone: () => void }) {
  const { target } = useDraft();
  return (
    <div className="space-y-group py-2 text-center">
      <div className="space-y-1">
        <p className="text-body font-semibold text-foreground">Added to {target.handle}&rsquo;s network</p>
      </div>
      <Button type="button" onClick={onDone} className="w-full sm:w-auto">
        Done
      </Button>
    </div>
  );
}

/** The fields and states that make up the composer. */
export const Composer = {
  Provider,
  Platform,
  Role,
  Outcome,
  Comment,
  ImageField,
  Error: ErrorNotice,
  Publish,
  Summary,
  Published,
};

/** Shown in place of the composer until the member has verified their ID. */
export function VerifyIdGate() {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-group">
      <p className="flex items-center gap-2 text-body font-semibold text-foreground">
        <HugeiconsIcon icon={ShieldCheckIcon} className="size-4 text-trust" aria-hidden />
        Verify your ID first
      </p>
      <p className="mt-1.5 text-body text-muted-foreground">
        Every reference is backed by a Stripe photo ID and selfie check. No bank or payout details are required.
      </p>
      <Button asChild size="sm" className="mt-cozy">
        <Link href="/profile?tab=verification">Verify ID with Stripe</Link>
      </Button>
    </div>
  );
}

/** The owner's link for asking people they have dealt with to leave a reference. */
export function CopyReferenceLink({ returnPath, className }: { returnPath: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${returnPath}?experience=1`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button variant="outline" className={cn('shrink-0', className)} onClick={copy}>
      <HugeiconsIcon icon={Copy01Icon} className="size-3.5" aria-hidden />
      {copied ? 'Copied link' : 'Share reference link'}
    </Button>
  );
}
