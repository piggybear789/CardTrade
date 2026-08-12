// components/profile/SocialLinksDisplay.tsx
//
// Renders a member's social media links as a row of icon-links. Each platform
// maps to a known URL pattern so only handles are stored, never full URLs.
//
// Two modes:
// - Default: spaced row for profile pages.
// - `compact`: tighter spacing for inline use in contract party cards.

import { ExternalLink } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Known platforms with their URL patterns and display labels. */
const PLATFORMS: Record<string, { label: string; urlPrefix: string; icon: string }> = {
  instagram: {
    label: 'Instagram',
    urlPrefix: 'https://instagram.com/',
    icon: 'instagram',
  },
  youtube: {
    label: 'YouTube',
    urlPrefix: 'https://youtube.com/@',
    icon: 'youtube',
  },
  tiktok: {
    label: 'TikTok',
    urlPrefix: 'https://tiktok.com/@',
    icon: 'tiktok',
  },
  twitter: {
    label: 'X (Twitter)',
    urlPrefix: 'https://x.com/',
    icon: 'twitter',
  },
  facebook: {
    label: 'Facebook',
    urlPrefix: 'https://facebook.com/',
    icon: 'facebook',
  },
  ebay: {
    label: 'eBay',
    urlPrefix: 'https://ebay.com.au/usr/',
    icon: 'ebay',
  },
};

/** SVG icons for platforms not in lucide. Kept minimal and inline. */
function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const base = cn('shrink-0', className);

  switch (platform) {
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={base} aria-hidden>
          <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
        </svg>
      );
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={base} aria-hidden>
          <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
          <path d="m10 15 5-3-5-3z" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={base} aria-hidden>
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.88-2.88 2.89 2.89 0 0 1 2.88-2.88c.28 0 .56.04.82.1v-3.5a6.37 6.37 0 0 0-.82-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.8a8.26 8.26 0 0 0 4.76 1.5V6.84a4.83 4.83 0 0 1-1-.15z" />
        </svg>
      );
    case 'twitter':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={base} aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={base} aria-hidden>
          <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
        </svg>
      );
    case 'ebay':
      return (
        <ExternalLink className={base} aria-hidden />
      );
    default:
      return (
        <ExternalLink className={base} aria-hidden />
      );
  }
}

export interface SocialLinksDisplayProps {
  socialLinks: Record<string, string> | null;
  /** Tighter spacing for inline use in contract party cards. */
  compact?: boolean;
  className?: string;
}

/**
 * Renders a member's social links as icon-links. Returns null when there are
 * no links to show.
 */
export function SocialLinksDisplay({ socialLinks, compact, className }: SocialLinksDisplayProps) {
  if (!socialLinks || Object.keys(socialLinks).length === 0) return null;

  const entries = Object.entries(socialLinks).filter(
    ([, handle]) => typeof handle === 'string' && handle.trim().length > 0,
  );

  if (entries.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center', compact ? 'gap-2' : 'gap-3', className)}>
      {entries.map(([platform, handle]) => {
        const config = PLATFORMS[platform];
        const url = config
          ? `${config.urlPrefix}${handle.trim()}`
          : `https://${platform}.com/${handle.trim()}`;
        const label = config?.label ?? platform;

        return (
          <a
            key={platform}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${label}: ${handle.trim()}`}
            className={cn(
              'inline-flex items-center gap-1 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              compact ? 'text-xs' : 'text-sm',
            )}
          >
            <PlatformIcon platform={platform} className={compact ? 'size-3.5' : 'size-4'} />
            {!compact && <span className="truncate">{handle.trim()}</span>}
          </a>
        );
      })}
    </div>
  );
}
