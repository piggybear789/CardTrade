// domain/social/socialLinks.ts
//
// Social media platform registry and URL builders. Handles are stored as plain
// usernames; this module builds the canonical profile URL for display.

/** Supported platforms, in display order. */
export const SOCIAL_PLATFORMS = [
  { slug: 'instagram', label: 'Instagram', icon: 'instagram', prefix: 'https://instagram.com/' },
  { slug: 'facebook', label: 'Facebook', icon: 'facebook', prefix: 'https://facebook.com/' },
  { slug: 'x', label: 'X', icon: 'twitter', prefix: 'https://x.com/' },
  { slug: 'youtube', label: 'YouTube', icon: 'youtube', prefix: 'https://youtube.com/@' },
  { slug: 'tiktok', label: 'TikTok', icon: 'music', prefix: 'https://tiktok.com/@' },
  { slug: 'discord', label: 'Discord', icon: 'message-circle', prefix: null },
] as const;

export type SocialPlatformSlug = (typeof SOCIAL_PLATFORMS)[number]['slug'];

export interface SocialLink {
  slug: SocialPlatformSlug;
  label: string;
  icon: string;
  handle: string;
  url: string | null;
}

/** Parse a stored social_links JSONB into typed display links. */
export function parseSocialLinks(
  raw: Record<string, string> | null | undefined,
): SocialLink[] {
  if (!raw || typeof raw !== 'object') return [];
  const links: SocialLink[] = [];
  for (const platform of SOCIAL_PLATFORMS) {
    const handle = raw[platform.slug]?.trim();
    if (!handle) continue;
    links.push({
      slug: platform.slug,
      label: platform.label,
      icon: platform.icon,
      handle,
      url: platform.prefix ? `${platform.prefix}${handle}` : null,
    });
  }
  return links;
}

/** Validate a handle: non-empty, no spaces, reasonable length. */
export function isValidHandle(handle: string): boolean {
  const trimmed = handle.trim();
  if (trimmed.length === 0 || trimmed.length > 100) return false;
  // No spaces, no URLs (just the handle/username part)
  if (/\s/.test(trimmed)) return false;
  // Strip leading @ if present
  return true;
}

/** Normalize a handle: trim, strip leading @. */
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '');
}

/** Build the social_links JSONB from a form submission. */
export function buildSocialLinksPayload(
  entries: { slug: string; handle: string }[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const normalized = normalizeHandle(entry.handle);
    if (normalized) {
      result[entry.slug] = normalized;
    }
  }
  return result;
}
