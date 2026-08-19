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
//   * it carried an `ebay` entry the editor can never produce — storefronts now
//     go through the `website` URL slot instead of a fake eBay handle
//
// It now reads `parseSocialLinks`, which is the same function every other consumer
// uses. That also means unknown keys in the stored JSONB are ignored rather than
// turned into a link to `https://<key>.com/`, which the old fallback did.

import { parseSocialLinks } from '@/domain/social/socialLinks';
import { cn } from '@/lib/utils';
import { SocialPlatformIcon } from '@/components/profile/SocialPlatformIcon';

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
          <SocialPlatformIcon slug={link.slug} className={compact ? 'size-3.5' : 'size-4'} />
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
