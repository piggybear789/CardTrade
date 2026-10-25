'use client';

// components/references/ReferenceComposer.tsx
//
// Leaving a reference (0155), and editing one you left, built on our standard UI
// primitives (`StarIcon` 1..5 rating, `Label`, `Textarea`, `Select`, `Button`,
// `PendingLabel`). The fields read one draft from context (`ReferenceDraft`):
// `useReferenceComposer` publishes a new reference, `useReferenceEditor` saves over
// one the member already left.

import {
  createContext,
  use,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Cancel01Icon,
  Copy01Icon,
  ImageAdd01Icon,
  StarIcon,
} from '@hugeicons/core-free-icons';

import { SocialPlatformIcon } from '@/components/profile/SocialPlatformIcon';
import { platformTint } from '@/components/references/referenceLabels';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { OptionButton } from '@/components/ui/option-button';
import { PendingLabel } from '@/components/ui/pending-label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  attachReferenceProof,
  giveReference,
  updateReference,
  type ReferenceTargetDescriptor,
} from '@/lib/actions/references';
import { uploadReferenceImage } from '@/lib/storage/uploadReferenceImage';
import { REFERENCE_IMAGE_ACCEPT } from '@/lib/storage/referenceImagesShared';
import { withQuery } from '@/domain/references/address';
import {
  FIRST_DEAL_YEAR,
  NEGATIVE_CATEGORIES,
  REFERENCE_PLATFORMS,
  REFERENCE_ROLES,
  REFERENCE_SENTIMENTS,
  isClaimPlatform,
  isNegativeCategory,
  isReferenceRole,
  type NegativeCategory,
  type ReferenceRole,
  type ReferenceSentiment,
} from '@/domain/references/reference';
import { cn } from '@/lib/utils';

const COMMENT_LIMIT = 500;
const PROOF_LIMIT = 3;
const NO_PROOFS: string[] = [];

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Who is looking, as far as leaving a reference goes. */
export interface ComposerViewer {
  signedIn: boolean;
  identityVerified: boolean;
  /** Looking at their own page, where they ask for references rather than leave one. */
  isSelf: boolean;
}

/** `YYYY-MM` for this month, where the member is. */
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Who the reference is for. A handle nobody has placed takes the platform the page names,
 * or else the one picked here, because that is the account it is about.
 */
function targetPayload(target: ReferenceTargetDescriptor, platform: string) {
  if (target.kind === 'profile') return { kind: 'profile' as const, profileId: target.id };
  if (target.kind === 'claim') return { kind: 'claim' as const, claimId: target.id };
  return { kind: 'handle' as const, handle: target.id, platform: target.platform ?? platform };
}

type PlatformOption = (typeof REFERENCE_PLATFORMS)[number];

/** The deal platforms a handle can also live on. */
const HANDLE_PLATFORMS = REFERENCE_PLATFORMS.filter((p) => isClaimPlatform(p.slug));

/**
 * The platforms the composer offers. For a handle whose platform is not known yet, only
 * platforms a handle can live on: picking one says where the account is.
 */
function platformOptionsFor(target: ReferenceTargetDescriptor): readonly PlatformOption[] {
  return target.kind === 'handle' && !target.platform ? HANDLE_PLATFORMS : REFERENCE_PLATFORMS;
}

function sentimentForRating(rating: number): ReferenceSentiment {
  if (rating <= 2) return 'NEGATIVE';
  if (rating === 3) return 'NEUTRAL';
  return 'POSITIVE';
}

/** What a negative reference is filed under: the member's pick, or "Other issue". */
function categoryFor(sentiment: ReferenceSentiment, category: NegativeCategory | null): NegativeCategory | null {
  return sentiment === 'NEGATIVE' ? (category ?? 'OTHER') : null;
}

const PICK_PLATFORM = 'Select which platform this account is on.';

/** Everything the composer fields read and set, whichever hook owns the draft. */
export interface ReferenceDraft {
  /** Who the reference is about, as the dialog names them. */
  subject: string;
  platformOptions: readonly PlatformOption[];
  platform: string;
  setPlatform: (next: string) => void;
  role: ReferenceRole;
  setRole: (next: ReferenceRole) => void;
  /** `YYYY-MM` of the deal. */
  month: string;
  setMonth: (next: string) => void;
  rating: number;
  setRating: (next: number) => void;
  sentiment: ReferenceSentiment;
  /** What went wrong, for a negative rating. Null until picked. */
  category: NegativeCategory | null;
  setCategory: (next: NegativeCategory) => void;
  comment: string;
  setComment: (next: string) => void;
  proofNames: string[];
  uploadingProof: boolean;
  attachProof: (files: FileList | null) => Promise<void>;
  removeProof: (index: number) => void;
  error: string | null;
  pending: boolean;
  publish: () => void;
  /** The first step's gate: a platform must be chosen before moving on. */
  requirePlatform: () => boolean;
}

/** The share dialog's draft: the fields, plus what a two-step dialog and sign-in need. */
export interface ComposerDraft extends ReferenceDraft {
  done: boolean;
  /** Back to an empty draft, as after publishing or cancelling. */
  reset: () => void;
  /** Keep the text of the draft through a sign-in round trip. False while incomplete. */
  saveDraftToSession: () => boolean;
}

/** A new reference, drafted in the share dialog and published with `giveReference`. */
export function useReferenceComposer(target: ReferenceTargetDescriptor): ComposerDraft {
  const router = useRouter();
  const storageKey = `noditto:ref-draft:${target.kind}:${target.platform ?? '*'}:${target.id.toLowerCase()}`;
  const platformOptions = platformOptionsFor(target);
  const [platform, setPlatformState] = useState<string>('');
  const [role, setRole] = useState<ReferenceRole>('BOUGHT');
  const [month, setMonth] = useState<string>(currentMonth);
  const [rating, setRating] = useState<number>(5);
  const [category, setCategory] = useState<NegativeCategory | null>(null);
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
      const parsed = JSON.parse(saved) as {
        platform?: string;
        role?: string;
        month?: string;
        rating?: number;
        category?: string;
        comment?: string;
      };
      if (isReferenceRole(parsed.role)) {
        setRole(parsed.role);
      }
      if (
        typeof parsed.platform === 'string' &&
        platformOptions.some((p) => p.slug === parsed.platform)
      ) {
        setPlatformState(parsed.platform);
      }
      if (typeof parsed.month === 'string' && /^\d{4}-\d{2}$/.test(parsed.month) && parsed.month <= currentMonth()) {
        setMonth(parsed.month);
      }
      if (typeof parsed.rating === 'number' && parsed.rating >= 1 && parsed.rating <= 5) {
        setRating(parsed.rating);
      }
      if (isNegativeCategory(parsed.category)) {
        setCategory(parsed.category);
      }
      if (typeof parsed.comment === 'string') {
        setComment(parsed.comment);
      }
    } catch {
      // ignore storage errors
    }
  }, [storageKey, platformOptions]);

  const saveDraftToSession = (): boolean => {
    if (!platform) {
      setError(PICK_PLATFORM);
      return false;
    }
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ platform, role, month, rating, category, comment }),
      );
    } catch {
      // ignore storage errors
    }
    return true;
  };

  const sentiment = sentimentForRating(rating);

  const requirePlatform = (): boolean => {
    if (platform) return true;
    setError(PICK_PLATFORM);
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
      setError(PICK_PLATFORM);
      return;
    }
    if (rating < 1 || rating > 5) {
      setError('Pick a rating from 1 to 5.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await giveReference({
        target: targetPayload(target, platform),
        platform,
        role,
        occurredMonth: month,
        rating,
        sentiment,
        category: categoryFor(sentiment, category),
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

  const reset = () => {
    setDone(false);
    setError(null);
    setPlatformState('');
    setRole('BOUGHT');
    setMonth(currentMonth());
    setRating(5);
    setCategory(null);
    setComment('');
    setProofPaths([]);
    setProofNames([]);
  };

  return {
    subject: target.handle,
    platformOptions,
    platform,
    setPlatform,
    role,
    setRole,
    month,
    setMonth,
    rating,
    setRating,
    sentiment,
    category,
    setCategory,
    comment,
    setComment,
    proofNames,
    uploadingProof,
    attachProof,
    removeProof,
    error,
    pending,
    publish,
    requirePlatform,
    done,
    reset,
    saveDraftToSession,
  };
}

/** A reference its author is changing, as the graph describes it. */
export interface EditableReference {
  id: string;
  /** Who it is about, as the dialog names them. */
  subject: string;
  platform: string;
  role: string;
  /** `YYYY-MM`. */
  month: string;
  rating: number;
  category: string | null;
  comment: string | null;
}

/** An existing reference, saved over the original with `updateReference`. */
export function useReferenceEditor(reference: EditableReference, onSaved: () => void): ReferenceDraft {
  const router = useRouter();
  const [platform, setPlatformState] = useState(reference.platform);
  const [role, setRole] = useState<ReferenceRole>(isReferenceRole(reference.role) ? reference.role : 'BOUGHT');
  const [month, setMonth] = useState(reference.month);
  const [rating, setRating] = useState(reference.rating);
  const [category, setCategory] = useState<NegativeCategory | null>(
    isNegativeCategory(reference.category) ? reference.category : null,
  );
  const [comment, setComment] = useState(reference.comment ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sentiment = sentimentForRating(rating);
  const platformKnown = REFERENCE_PLATFORMS.some((p) => p.slug === platform);

  const setPlatform = (next: string) => {
    setPlatformState(next);
    setError(null);
  };

  const requirePlatform = (): boolean => {
    if (platformKnown) return true;
    setError(PICK_PLATFORM);
    return false;
  };

  const publish = () => {
    if (!requirePlatform()) return;
    setError(null);
    startTransition(async () => {
      const result = await updateReference(reference.id, {
        platform,
        role,
        occurredMonth: month,
        rating,
        sentiment,
        category: categoryFor(sentiment, category),
        comment,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onSaved();
      router.refresh();
    });
  };

  return {
    subject: reference.subject,
    platformOptions: REFERENCE_PLATFORMS,
    platform,
    setPlatform,
    role,
    setRole,
    month,
    setMonth,
    rating,
    setRating,
    sentiment,
    category,
    setCategory,
    comment,
    setComment,
    proofNames: NO_PROOFS,
    uploadingProof: false,
    attachProof: async () => {},
    removeProof: () => {},
    error,
    pending,
    publish,
    requirePlatform,
  };
}

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

function Platform() {
  const { platform, setPlatform, platformOptions } = useDraft();

  return (
    <div className="space-y-snug">
      <Label>Platform</Label>
      <div
        role="radiogroup"
        aria-label="Platform"
        className="grid grid-cols-2 gap-snug sm:grid-cols-3"
      >
        {platformOptions.map((p) => {
          const selected = platform === p.slug;
          return (
            <OptionButton key={p.slug} selected={selected} onClick={() => setPlatform(p.slug)}>
              <SocialPlatformIcon
                slug={p.slug}
                className={cn(
                  p.slug === 'ebay' || p.slug === 'whatnot' ? 'size-4' : 'size-3.5',
                  platformTint(p.slug),
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

/**
 * When the deal happened, as a month and a year. A month that has not happened yet
 * cannot be picked; changing the year to this one pulls a later month back to now.
 */
function Month() {
  const { month, setMonth } = useDraft();
  const labelId = useId();
  const now = currentMonth();
  const [year, mm] = month.split('-');
  const years: string[] = [];
  for (let y = Number(now.slice(0, 4)); y >= FIRST_DEAL_YEAR; y -= 1) years.push(String(y));

  return (
    <div className="space-y-snug">
      <Label id={labelId}>When</Label>
      <div role="group" aria-labelledby={labelId} className="grid grid-cols-[minmax(0,1fr)_7rem] gap-snug">
        <Select value={mm} onValueChange={(next) => setMonth(`${year}-${next}`)}>
          <SelectTrigger aria-label="Month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTH_NAMES.map((name, index) => {
              const value = String(index + 1).padStart(2, '0');
              return (
                <SelectItem key={value} value={value} disabled={`${year}-${value}` > now}>
                  {name}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Select
          value={year}
          onValueChange={(next) => {
            const candidate = `${next}-${mm}`;
            setMonth(candidate > now ? now : candidate);
          }}
        >
          <SelectTrigger aria-label="Year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

/** What went wrong, asked only of a negative rating. Unpicked, it is filed as "Other issue". */
function Category() {
  const { sentiment, category, setCategory } = useDraft();
  if (sentiment !== 'NEGATIVE') return null;

  return (
    <div className="space-y-snug">
      <Label>What went wrong</Label>
      <div role="radiogroup" aria-label="What went wrong" className="grid grid-cols-1 gap-snug sm:grid-cols-2">
        {NEGATIVE_CATEGORIES.map((c) => (
          <OptionButton key={c.slug} selected={category === c.slug} onClick={() => setCategory(c.slug)}>
            <span className="truncate">{c.label}</span>
          </OptionButton>
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

function Publish({
  className,
  children = 'Publish reference',
  pendingLabel = 'Publishing…',
}: {
  className?: string;
  children?: ReactNode;
  pendingLabel?: string;
}) {
  const { pending, uploadingProof, publish } = useDraft();
  return (
    <Button
      type="button"
      disabled={pending || uploadingProof}
      aria-busy={pending}
      onClick={publish}
      className={className}
    >
      <PendingLabel pending={pending} pendingLabel={pendingLabel}>
        {children}
      </PendingLabel>
    </Button>
  );
}

/** What follows a published reference. */
function Published({ onDone }: { onDone: () => void }) {
  const { subject } = useDraft();
  return (
    <div className="space-y-group py-2 text-center">
      <div className="space-y-1">
        <p className="text-body font-semibold text-foreground">Added to {subject}&rsquo;s network</p>
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
  Month,
  Outcome,
  Category,
  Comment,
  ImageField,
  Error: ErrorNotice,
  Publish,
  Published,
};

/** The owner's link for asking people they have dealt with to leave a reference. */
export function CopyReferenceLink({ returnPath, className }: { returnPath: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${withQuery(returnPath, { experience: '1' })}`);
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
