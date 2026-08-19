// domain/social/socialLinks.ts
//
// Profile-link registry. Socials store a username; Website stores one https URL
// (eBay, TCGPlayer, Shopify, a personal shop). Those are different shapes —
// do not run a website value through `isValidHandle`.

const WEBSITE_MAX_LENGTH = 500;

export const SOCIAL_PLATFORMS = [
  { slug: 'website', label: 'Website', icon: 'globe', kind: 'url', prefix: null },
  { slug: 'instagram', label: 'Instagram', icon: 'instagram', kind: 'handle', prefix: 'https://instagram.com/' },
  { slug: 'facebook', label: 'Facebook', icon: 'facebook', kind: 'handle', prefix: 'https://facebook.com/' },
  { slug: 'x', label: 'X', icon: 'twitter', kind: 'handle', prefix: 'https://x.com/' },
  { slug: 'youtube', label: 'YouTube', icon: 'youtube', kind: 'handle', prefix: 'https://youtube.com/@' },
  { slug: 'tiktok', label: 'TikTok', icon: 'music', kind: 'handle', prefix: 'https://tiktok.com/@' },
  { slug: 'discord', label: 'Discord', icon: 'message-circle', kind: 'handle', prefix: null },
] as const;

export type SocialPlatformSlug = (typeof SOCIAL_PLATFORMS)[number]['slug'];
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface SocialLink {
  slug: SocialPlatformSlug;
  label: string;
  icon: string;
  kind: SocialPlatform['kind'];
  /** Username for socials; hostname for Website. */
  handle: string;
  url: string | null;
}

export function platformBySlug(slug: string): SocialPlatform | undefined {
  return SOCIAL_PLATFORMS.find((platform) => platform.slug === slug);
}

/** Parse a stored social_links JSONB into typed display links. */
export function parseSocialLinks(
  raw: Record<string, string> | null | undefined,
): SocialLink[] {
  if (!raw || typeof raw !== 'object') return [];
  const links: SocialLink[] = [];
  for (const platform of SOCIAL_PLATFORMS) {
    const stored = raw[platform.slug]?.trim();
    if (!stored) continue;

    if (platform.kind === 'url') {
      const url = normalizeWebsiteUrl(stored);
      if (!url) continue;
      links.push({
        slug: platform.slug,
        label: platform.label,
        icon: platform.icon,
        kind: platform.kind,
        handle: websiteDisplayHost(url),
        url,
      });
      continue;
    }

    links.push({
      slug: platform.slug,
      label: platform.label,
      icon: platform.icon,
      kind: platform.kind,
      handle: stored,
      url: platform.prefix ? `${platform.prefix}${stored}` : null,
    });
  }
  return links;
}

/**
 * A stored handle is the username only. Empty is not valid here — callers that
 * treat blank as "omit this platform" should check that before calling.
 */
export function isValidHandle(handle: string): boolean {
  const trimmed = normalizeHandle(handle);
  if (trimmed.length === 0 || trimmed.length > 100) return false;
  if (/\s/.test(trimmed)) return false;
  // Schemes and paths mean they pasted a URL, not a username.
  if (/[/:]/.test(trimmed)) return false;
  return true;
}

/** Normalize a handle: trim, strip leading @. */
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '');
}

/**
 * One public https URL. Bare hostnames get `https://`. http is upgraded.
 * Credentials, non-https schemes, localhost, and bare hosts without a TLD
 * are rejected — this sits next to Verified on a public profile.
 */
export function normalizeWebsiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > WEBSITE_MAX_LENGTH) return '';

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return '';
  }

  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') return '';
  if (url.username || url.password) return '';

  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return '';
  if (host.includes(':')) return '';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return '';
  if (!host.includes('.')) return '';

  url.username = '';
  url.password = '';
  url.hash = '';
  url.hostname = host;

  const href = url.href;
  return href.length > WEBSITE_MAX_LENGTH ? '' : href;
}

export function isValidWebsiteUrl(raw: string): boolean {
  return normalizeWebsiteUrl(raw).length > 0;
}

/** Hostname without a leading www, for display. */
export function websiteDisplayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function normalizeLinkValue(slug: string, raw: string): string {
  const platform = platformBySlug(slug);
  if (!platform) return '';
  return platform.kind === 'url'
    ? normalizeWebsiteUrl(raw)
    : normalizeHandle(raw);
}

export function isValidLinkValue(slug: string, raw: string): boolean {
  const platform = platformBySlug(slug);
  if (!platform) return false;
  const normalized = normalizeLinkValue(slug, raw);
  if (!normalized) return false;
  return platform.kind === 'url' ? isValidWebsiteUrl(normalized) : isValidHandle(normalized);
}

/** Build the social_links JSONB from a form submission. */
export function buildSocialLinksPayload(
  entries: { slug: string; value: string }[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const normalized = normalizeLinkValue(entry.slug, entry.value);
    if (normalized) {
      result[entry.slug] = normalized;
    }
  }
  return result;
}
