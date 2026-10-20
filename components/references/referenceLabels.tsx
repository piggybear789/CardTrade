// components/references/referenceLabels.tsx
//
// Badges shared across the references surfaces: brand icons for every known
// platform (Instagram, Facebook, Discord, eBay, Whatnot, NoDitto, X, YouTube,
// TikTok), sentiment marks, and counted nouns.

import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlertCircleIcon,
  StarIcon,
} from '@hugeicons/core-free-icons';

import { SocialPlatformIcon } from '@/components/profile/SocialPlatformIcon';
import { platformLabel, type ReferenceSentiment } from '@/domain/references/reference';
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

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
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

export function SentimentBadge({
  sentiment,
  rating,
}: {
  sentiment: ReferenceSentiment;
  rating?: number;
}) {
  const stars =
    rating ?? (sentiment === 'NEGATIVE' ? 1 : sentiment === 'NEUTRAL' ? 3 : 5);
  const label = `${stars} out of 5 stars`;

  if (sentiment === 'NEGATIVE') {
    return (
      <span
        role="img"
        title={label}
        aria-label={label}
        className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 text-[11px] font-semibold tabular-nums text-destructive"
      >
        <HugeiconsIcon icon={StarIcon} className="size-3 fill-destructive" aria-hidden />
        <span>{stars}</span>
      </span>
    );
  }
  if (sentiment === 'NEUTRAL') {
    return (
      <span
        role="img"
        title={label}
        aria-label={label}
        className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full border border-action-border/40 bg-action/35 px-1.5 text-[11px] font-semibold tabular-nums text-action-foreground"
      >
        <HugeiconsIcon icon={StarIcon} className="size-3 fill-action-foreground" aria-hidden />
        <span>{stars}</span>
      </span>
    );
  }
  return (
    <span
      role="img"
      title={label}
      aria-label={label}
      className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full bg-trust/10 px-1.5 text-[11px] font-semibold tabular-nums text-trust"
    >
      <HugeiconsIcon icon={StarIcon} className="size-3 fill-trust" aria-hidden />
      <span>{stars}</span>
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
          PLATFORM_COLOR[slug] ?? 'text-muted-foreground',
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
