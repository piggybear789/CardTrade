// components/references/referenceLabels.tsx
//
// Badges shared across the references surfaces: brand icons for every known
// platform (Instagram, Facebook, Discord, eBay, Whatnot, NoDitto, X, YouTube,
// TikTok), sentiment marks, and counted nouns.

import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  MinusSignCircleIcon,
} from '@hugeicons/core-free-icons';

import { SocialPlatformIcon } from '@/components/profile/SocialPlatformIcon';
import { platformLabel, sentimentLabel, type ReferenceSentiment } from '@/domain/references/reference';
import type { ReferenceProof } from '@/lib/references/graph';
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
  return null;
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

/** Each sentiment's mark and tint, matching the Good / So-so / Bad counts above a graph. */
const SENTIMENT_STYLE: Record<ReferenceSentiment, { icon: typeof CheckmarkCircle02Icon; chip: string }> = {
  POSITIVE: { icon: CheckmarkCircle02Icon, chip: 'bg-trust/10 text-trust' },
  // NO BORDER, like the positive and negative chips. `border-action-border/40` is not a
  // class here (the token is `action-edge`), so it fell back to a grey hairline.
  NEUTRAL: { icon: MinusSignCircleIcon, chip: 'bg-action/35 text-action-foreground' },
  NEGATIVE: { icon: AlertCircleIcon, chip: 'bg-destructive/10 text-destructive' },
};

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
  const { icon, chip } = SENTIMENT_STYLE[sentiment];
  const label = sentimentLabel(sentiment);
  return (
    <span
      title={`${label} experience`}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full font-semibold',
        size === 'md' ? 'h-6 gap-1 px-2 text-meta' : 'h-5 gap-0.5 px-1.5 text-[11px]',
        chip,
        className,
      )}
    >
      <HugeiconsIcon icon={icon} className={size === 'md' ? 'size-3.5' : 'size-3'} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function PlatformChip({ slug, className }: { slug: string; className?: string }) {
  const label = platformLabel(slug);

  if (BRAND_ICON_PLATFORMS.has(slug)) {
    return (
      <span
        role="img"
        title={label}
        aria-label={label}
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/40',
          platformTint(slug),
          className,
        )}
      >
        <SocialPlatformIcon
          slug={slug}
          className={slug === 'ebay' || slug === 'noditto' || slug === 'whatnot' ? 'size-4' : 'size-3.5'}
        />
      </span>
    );
  }

  return (
    <span
      title={label}
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full border border-border/80 bg-muted/40 px-2 text-meta font-medium text-muted-foreground',
        className,
      )}
    >
      {label}
    </span>
  );
}
