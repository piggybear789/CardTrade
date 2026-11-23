// components/references/referenceLabels.tsx
//
// Badges shared across the references surfaces: brand icons for every known
// platform (Instagram, Facebook, Discord, eBay, Whatnot, NoDitto, X, YouTube,
// TikTok), sentiment marks, and counted nouns.

import type { ReactNode } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';

import { SocialPlatformIcon } from '@/components/profile/SocialPlatformIcon';
import { StatusGlyph, type StatusGlyphKind } from '@/components/ui/status-glyph';
import { platformLabel, sentimentLabel, type ReferenceSentiment } from '@/domain/references/reference';
import type { ReferenceGraphNode, ReferenceProof } from '@/lib/references/graph';
import { cn } from '@/lib/utils';

const BRAND_ICON_PLATFORMS = new Set([
  'instagram',
  'facebook',
  'discord',
  'ebay',
  'whatnot',
  'noditto',
  'x',
  'youtube',
  'tiktok',
]);

const PLATFORM_COLOR: Record<string, string> = {
  instagram: 'text-[#E1306C]',
  facebook: 'text-[#1877F2]',
  discord: 'text-[#5865F2]',
  ebay: 'text-[#E53238]',
  whatnot: 'text-foreground',
  noditto: 'text-foreground',
  x: 'text-foreground',
  youtube: 'text-[#FF0000]',
  tiktok: 'text-foreground',
};

/** The text colour a platform's brand icon is drawn in. */
export function platformTint(slug: string): string {
  return PLATFORM_COLOR[slug] ?? 'text-muted-foreground';
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * What backs a reference beyond its author's word. A plain vouch says nothing. A NoDitto
 * deal is a completed cash sale OR trade, so it is never called "escrow": a trade's
 * collateral is a card hold, not money the platform holds.
 */
export function proofLabel(kind: ReferenceProof): string | null {
  if (kind === 'escrow') return 'Completed on NoDitto';
  if (kind === 'receipt') return 'Receipt checked';
  if (kind === 'ebay') return 'eBay feedback';
  return null;
}

/** A reference's proof in words. eBay's own "Verified purchase" mark is said as such. */
export function referenceProofLabel(node: Pick<ReferenceGraphNode, 'kind' | 'external'>): string | null {
  if (node.external?.verifiedPurchase) return 'eBay verified purchase';
  return proofLabel(node.kind);
}

const COUNT_FORMAT = new Intl.NumberFormat('en-AU');

/**
 * Who a reference's author is, in the one line under their name: their own references
 * here, or for an eBay feedback author their own eBay feedback score.
 */
export function authorStanding(node: Pick<ReferenceGraphNode, 'refs' | 'external'>): string {
  if (node.external) {
    return node.external.authorScore === null
      ? 'eBay member'
      : `${COUNT_FORMAT.format(node.external.authorScore)} eBay feedback`;
  }
  return `${node.refs} ${node.refs === 1 ? 'ref' : 'refs'}`;
}

export function IssueBadge({ category }: { category: string | null }) {
  const label = category ?? 'Bad experience';
  return (
    <span
      role="img"
      title={label}
      aria-label={label}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
    >
      <HugeiconsIcon icon={AlertCircleIcon} className="size-3.5" aria-hidden />
    </span>
  );
}

/**
 * WHEN A TAG, WHEN AN ICON, WHEN TEXT. The references pages' rule, after RevenueCat
 * (probed 2026-11-21), whose pages do use tags and icons, just never as a tinted capsule
 * around a number.
 *
 *   TAG   a discrete STATE a reader scans for: a reference's sentiment, the footprint
 *         verdict. A white capsule on a soft shadow (`.ref-tag`, RevenueCat's "Funnels"
 *         eyebrow), the icon in the state's colour, the word in ink. The colour lives in
 *         the icon, so a page of 23 "Good" tags is calm and the one "Bad" one, red from
 *         icon to word on a red-tinted capsule, is the loudest thing in the list.
 *   ICON  names a KIND of thing faster than a word: a platform's logo, verified, a
 *         warning, eBay's star. Bare, in its colour, beside its text.
 *   TEXT  a COUNT. The number and its unit ("84 positive"), with an icon in front when
 *         the icon says what is being counted. Never a filled capsule: "✓ 84" in a green
 *         pill was the most generated-looking thing on these pages, a tick saying what
 *         the green already said around a number with no unit.
 */
export type TagTone = 'trust' | 'caution' | 'danger' | 'neutral';

const TAG_TONE: Record<TagTone, { icon: string; text: string; surface: string }> = {
  trust: { icon: 'text-trust', text: 'text-foreground', surface: 'bg-card' },
  caution: { icon: 'text-action-edge', text: 'text-foreground', surface: 'bg-card' },
  // The exception stays loud: red word on a red-tinted capsule with a red edge.
  danger: { icon: 'text-destructive', text: 'font-semibold text-destructive', surface: 'ref-tag-danger bg-destructive/[0.06]' },
  neutral: { icon: 'text-muted-foreground', text: 'text-muted-foreground', surface: 'bg-card' },
};

/**
 * A state tag: white capsule, soft shadow, a mark in the tone's colour, the word.
 *
 * `icon` is a `StatusGlyph` kind for a mark that IS the state (good, bad, verified),
 * drawn filled so its colour reads as a shape; or a Hugeicons outline icon for a
 * neutral state that has no colour to carry ("Limited history").
 */
export function Tag({
  icon,
  tone,
  size = 'sm',
  className,
  title,
  children,
}: {
  icon: IconSvgElement | StatusGlyphKind;
  tone: TagTone;
  /** `md` beside a heading or for the one item a panel is about; `sm` in lists. */
  size?: 'sm' | 'md';
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const style = TAG_TONE[tone];
  return (
    <span
      title={title}
      className={cn(
        'ref-tag inline-flex shrink-0 items-center whitespace-nowrap rounded-md font-medium leading-none',
        size === 'md' ? 'h-7 gap-1.5 pl-2 pr-2.5 text-meta' : 'h-6 gap-1 pl-1.5 pr-2 text-meta',
        style.surface,
        style.text,
        className,
      )}
    >
      {typeof icon === 'string' ? (
        <StatusGlyph kind={icon} className={size === 'md' ? 'size-4' : 'size-3.5'} />
      ) : (
        <HugeiconsIcon icon={icon} className={cn(size === 'md' ? 'size-4' : 'size-3.5', 'shrink-0', style.icon)} aria-hidden />
      )}
      {children}
    </span>
  );
}

/** Each sentiment's filled mark and tag tone. */
const SENTIMENT_TAG: Record<ReferenceSentiment, { icon: StatusGlyphKind; tone: TagTone }> = {
  POSITIVE: { icon: 'success', tone: 'trust' },
  NEUTRAL: { icon: 'neutral', tone: 'caution' },
  NEGATIVE: { icon: 'danger', tone: 'danger' },
};

/** The filled mark a sentiment is drawn with, for filters and counts. */
export function sentimentGlyph(sentiment: ReferenceSentiment): StatusGlyphKind {
  return SENTIMENT_TAG[sentiment].icon;
}

/** How a reference went, in words: Good, So-so or Bad. References carry no stars (0169). */
export function SentimentBadge({
  sentiment,
  size = 'sm',
  className,
}: {
  sentiment: ReferenceSentiment;
  /** `md` for the one reference a panel is about; `sm` in lists. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { icon, tone } = SENTIMENT_TAG[sentiment];
  const label = sentimentLabel(sentiment);
  return (
    <Tag icon={icon} tone={tone} size={size} title={`${label} experience`} className={className}>
      {label}
    </Tag>
  );
}

/**
 * A platform's mark. As a TILE (the default) it is the logo in a grey disc, used where it
 * stands in for a picture (a row's avatar slot). `bare` is the logo alone, for inline use
 * beside a handle or in a list row: a ring of grey-edged discs after every name was the
 * same "everything in a capsule" look as the count pills.
 */
export function PlatformChip({
  slug,
  className,
  bare = false,
}: {
  slug: string;
  className?: string;
  bare?: boolean;
}) {
  const label = platformLabel(slug);

  if (BRAND_ICON_PLATFORMS.has(slug)) {
    return (
      <span
        role="img"
        title={label}
        aria-label={label}
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center',
          bare ? null : 'rounded-full border border-border bg-muted/40',
          platformTint(slug),
          className,
        )}
      >
        {/* Bare, the logo is the whole mark, so it fills its box (a wordmark like eBay's
            was 16px wide inside a 20px box and unreadable); a glyph keeps a little air. */}
        <SocialPlatformIcon
          slug={slug}
          className={
            slug === 'ebay' || slug === 'noditto' || slug === 'whatnot'
              ? bare
                ? 'size-full'
                : 'size-4'
              : bare
                ? 'size-[85%]'
                : 'size-3.5'
          }
        />
      </span>
    );
  }

  return (
    <span
      title={label}
      className={cn(
        'inline-flex h-6 shrink-0 items-center text-meta font-medium text-muted-foreground',
        bare ? null : 'rounded-md border border-border bg-muted/40 px-2',
        className,
        // A word, not a mark: a caller's square size (`size-4`, sized for the logos
        // beside it) squeezed "Other" to 16px and the next logo was drawn over it.
        '!w-auto',
      )}
    >
      {label}
    </span>
  );
}
