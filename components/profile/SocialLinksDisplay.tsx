// components/profile/SocialLinksDisplay.tsx
//
// Renders a member's social links as icon links.
//
// ONE PLATFORM REGISTRY. This component used to keep its OWN map of platforms,
// labels and URL prefixes alongside the real one in `domain/social/socialLinks.ts`,
// and the two had already drifted:
//
//   * the editor saves the slug `x`, this map keyed it as `twitter` — so an X handle
//     fell through to a generic fallback icon and rendered its label as the raw
//     string "x"
//   * `discord` was absent entirely, and the fallback built
//     `https://discord.com/<handle>` — a link that goes nowhere, because Discord has
//     no public profile URL. The domain registry encodes exactly that by setting its
//     prefix to null
//   * it carried an `ebay` entry the editor can never produce
//
// It now reads `parseSocialLinks`, which is the same function every other consumer
// uses. That also means unknown keys in the stored JSONB are ignored rather than
// turned into a link to `https://<key>.com/`, which the old fallback did.

import { ExternalLink } from 'lucide-react';

import { parseSocialLinks } from '@/domain/social/socialLinks';
import { cn } from '@/lib/utils';

/**
 * Brand glyphs, keyed by the DOMAIN REGISTRY's slug — not by a local list. Lucide
 * dropped its brand icons, so these are inline paths.
 */
function PlatformIcon({ slug, className }: { slug: string; className?: string }) {
  const base = cn('shrink-0', className);

  switch (slug) {
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
    // Keyed `x`, matching the registry slug. Previously `twitter`, which no stored
    // handle has ever used.
    case 'x':
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
    case 'discord':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={base} aria-hidden>
          <path d="M20.32 4.57A19.79 19.79 0 0 0 15.43 3c-.2.36-.43.85-.6 1.24a18.3 18.3 0 0 0-5.66 0c-.16-.39-.4-.88-.6-1.24a19.74 19.74 0 0 0-4.9 1.57C.9 9.09.07 13.47.49 17.79a19.9 19.9 0 0 0 6 3.04c.48-.66.91-1.36 1.28-2.1-.7-.26-1.38-.59-2.01-.97.17-.13.33-.26.49-.4a14.2 14.2 0 0 0 12.12 0c.16.14.32.27.49.4-.64.38-1.31.71-2.02.97.37.74.8 1.44 1.29 2.1a19.87 19.87 0 0 0 6-3.04c.5-5.02-.83-9.36-3.81-13.22ZM8.3 15.14c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.21 0 2.18 1.09 2.16 2.4 0 1.33-.95 2.41-2.16 2.41Zm7.4 0c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.21 0 2.18 1.09 2.16 2.4 0 1.33-.95 2.41-2.16 2.41Z" />
        </svg>
      );
    default:
      return <ExternalLink className={base} aria-hidden />;
  }
}

export interface SocialLinksDisplayProps {
  socialLinks: Record<string, string> | null;
  /** Tighter spacing for inline use in contract party cards. */
  compact?: boolean;
  className?: string;
}

/**
 * A member's social links. Renders nothing when there are none.
 *
 * A platform with no public profile URL (Discord) renders as plain text rather than
 * a dead link — `parseSocialLinks` reports that by returning a null `url`.
 */
export function SocialLinksDisplay({
  socialLinks,
  compact,
  className,
}: SocialLinksDisplayProps) {
  const links = parseSocialLinks(socialLinks);
  if (links.length === 0) return null;

  return (
    <div
      className={cn('flex flex-wrap items-center', compact ? 'gap-snug' : 'gap-cozy', className)}
    >
      {links.map((link) => {
        const icon = (
          <PlatformIcon slug={link.slug} className={compact ? 'size-3.5' : 'size-4'} />
        );
        const shared = cn(
          'inline-flex items-center gap-1 rounded-sm text-muted-foreground',
          compact ? 'text-meta' : 'text-body',
        );

        // No URL: show the handle without pretending it is navigable.
        if (!link.url) {
          return (
            <span key={link.slug} className={shared} title={`${link.label}: ${link.handle}`}>
              {icon}
              {compact ? (
                <span className="sr-only">{`${link.label}: ${link.handle}`}</span>
              ) : (
                <span className="truncate">{link.handle}</span>
              )}
            </span>
          );
        }

        return (
          <a
            key={link.slug}
            href={link.url}
            target="_blank"
            // `noopener` matters on a member-supplied destination: without it the
            // opened page gets a handle on this window via `window.opener`.
            rel="noopener noreferrer nofollow"
            aria-label={`${link.label}: ${link.handle}`}
            className={cn(
              shared,
              'transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {icon}
            {compact ? null : <span className="truncate">{link.handle}</span>}
          </a>
        );
      })}
    </div>
  );
}
