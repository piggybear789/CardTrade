// domain/references/lookup.ts
//
// Pure parsing and normalization for References lookup inputs: handles, profile URLs
// (Facebook Marketplace, Instagram, eBay), full names (e.g. Facebook Marketplace sellers),
// and Messenger payment identifiers.
//
// Pure: no React, Node crypto, or Supabase imports.

import { isValidClaimHandle, type ClaimPlatform } from '@/domain/references/reference';
import { normalizeHandle } from '@/domain/social/socialLinks';

export type ParsedLookupInput =
  | {
      kind: 'handle';
      handle: string;
      platform: ClaimPlatform | null;
      sourceUrl: string | null;
      /** Extracted display name when a URL carries one (e.g. `facebook.com/people/John-Smith/615...`). */
      extractedName?: string | null;
      isNumericFbId?: boolean;
      fromUrl?: boolean;
    }
  | {
      kind: 'name';
      name: string;
    };

/** First path segments on facebook.com that are site sections, never a person's vanity name. */
export const RESERVED_FB_PATHS: ReadonlySet<string> = new Set([
  'marketplace',
  'groups',
  'watch',
  'events',
  'pages',
  'login',
  'share',
  'reel',
  'reels',
  'stories',
  'help',
  'privacy',
  'settings',
  'photo',
  'photos',
  'video',
  'videos',
  'gaming',
  'friends',
]);

const RESERVED_IG_PATHS = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'explore',
  'accounts',
  'stories',
  'direct',
  'about',
  'developer',
]);

function tryParseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme =
    /^https?:\/\//i.test(trimmed)
      ? trimmed
      : /^(?:www\.|m\.|mbasic\.)?(?:facebook\.com|fb\.com|instagram\.com|instagr\.am|ebay\.[a-z.]+|whatnot\.com|tiktok\.com|x\.com|twitter\.com|youtube\.com)\//i.test(
            trimmed,
          )
        ? `https://${trimmed}`
        : null;
  if (!withScheme) return null;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

/**
 * Classifies what a user typed or pasted into the References search bar:
 * - Facebook Marketplace/profile URL -> `{ kind: 'handle', platform: 'facebook', ... }`
 * - Instagram / eBay / Whatnot / TikTok / X / YouTube profile URL -> `{ kind: 'handle', platform, fromUrl: true }`
 * - Single-token username (`@foo` or `foo`) -> `{ kind: 'handle', platform: null }`
 * - Multi-word name (`"John Smith"`) -> `{ kind: 'name', name: 'John Smith' }`
 */
export function parseReferenceLookupInput(raw: string): ParsedLookupInput | null {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;

  const url = tryParseUrl(trimmed);
  if (url) {
    const host = url.hostname.toLowerCase().replace(/^(?:www|m|mbasic)\./, '');
    const parts = url.pathname.split('/').filter(Boolean);

    if (host === 'facebook.com' || host === 'fb.com') {
      // /marketplace/profile/100012345678901/
      if (parts[0] === 'marketplace' && parts[1] === 'profile' && parts[2] && /^\d{5,30}$/.test(parts[2])) {
        return {
          kind: 'handle',
          handle: parts[2],
          platform: 'facebook',
          sourceUrl: `https://www.facebook.com/marketplace/profile/${parts[2]}/`,
          isNumericFbId: true,
          fromUrl: true,
        };
      }
      // /profile.php?id=100012345678901
      if (parts[0] === 'profile.php') {
        const id = url.searchParams.get('id')?.trim();
        if (id && /^\d{5,30}$/.test(id)) {
          return {
            kind: 'handle',
            handle: id,
            platform: 'facebook',
            sourceUrl: `https://www.facebook.com/profile.php?id=${id}`,
            isNumericFbId: true,
            fromUrl: true,
          };
        }
      }
      // /people/John-Smith/61561234567890/ — extracts BOTH numeric ID and person name!
      if (parts[0] === 'people' && parts[2] && /^\d{5,30}$/.test(parts[2])) {
        const decodedName = decodeURIComponent(parts[1] ?? '').replace(/[-_+]+/g, ' ').trim();
        return {
          kind: 'handle',
          handle: parts[2],
          platform: 'facebook',
          sourceUrl: `https://www.facebook.com/people/${parts[1]}/${parts[2]}/`,
          extractedName: decodedName.length >= 2 ? decodedName : null,
          isNumericFbId: true,
          fromUrl: true,
        };
      }
      // /<vanity>
      if (parts[0] && !RESERVED_FB_PATHS.has(parts[0].toLowerCase())) {
        const clean = normalizeHandle(parts[0]);
        if (isValidClaimHandle('facebook', clean)) {
          return {
            kind: 'handle',
            handle: clean,
            platform: 'facebook',
            sourceUrl: `https://www.facebook.com/${clean}`,
            isNumericFbId: /^\d{5,30}$/.test(clean),
            fromUrl: true,
          };
        }
      }
    }

    if ((host === 'instagram.com' || host === 'instagr.am') && parts[0] && !RESERVED_IG_PATHS.has(parts[0].toLowerCase())) {
      const clean = normalizeHandle(parts[0]);
      if (isValidClaimHandle('instagram', clean)) {
        return {
          kind: 'handle',
          handle: clean,
          platform: 'instagram',
          sourceUrl: `https://www.instagram.com/${clean}/`,
          fromUrl: true,
        };
      }
    }

    if (host.startsWith('ebay.') && (parts[0] === 'usr' || parts[0] === 'str') && parts[1]) {
      const clean = normalizeHandle(parts[1]);
      if (isValidClaimHandle('ebay', clean)) {
        return {
          kind: 'handle',
          handle: clean,
          platform: 'ebay',
          sourceUrl: `https://${host}/${parts[0]}/${clean}`,
          fromUrl: true,
        };
      }
    }

    if (host === 'whatnot.com' && parts[0] === 'user' && parts[1]) {
      const clean = normalizeHandle(parts[1]);
      if (isValidClaimHandle('whatnot', clean)) {
        return {
          kind: 'handle',
          handle: clean,
          platform: 'whatnot',
          sourceUrl: `https://www.whatnot.com/user/${clean}`,
          fromUrl: true,
        };
      }
    }

    if (host === 'tiktok.com' && parts[0]?.startsWith('@')) {
      const clean = normalizeHandle(parts[0]);
      if (isValidClaimHandle('tiktok', clean)) {
        return {
          kind: 'handle',
          handle: clean,
          platform: 'tiktok',
          sourceUrl: `https://www.tiktok.com/@${clean}`,
          fromUrl: true,
        };
      }
    }

    if ((host === 'x.com' || host === 'twitter.com') && parts[0] && !['home', 'explore', 'search', 'i', 'intent'].includes(parts[0].toLowerCase())) {
      const clean = normalizeHandle(parts[0]);
      if (isValidClaimHandle('x', clean)) {
        return {
          kind: 'handle',
          handle: clean,
          platform: 'x',
          sourceUrl: `https://x.com/${clean}`,
          fromUrl: true,
        };
      }
    }

    if (host === 'youtube.com' && parts[0]?.startsWith('@')) {
      const clean = normalizeHandle(parts[0]);
      if (isValidClaimHandle('youtube', clean)) {
        return {
          kind: 'handle',
          handle: clean,
          platform: 'youtube',
          sourceUrl: `https://www.youtube.com/@${clean}`,
          fromUrl: true,
        };
      }
    }
  }

  // Single token without spaces: check if it is a valid handle.
  if (!/\s/.test(trimmed)) {
    const clean = normalizeHandle(trimmed);
    if (isValidClaimHandle(null, clean)) {
      return {
        kind: 'handle',
        handle: clean,
        platform: null,
        sourceUrl: null,
      };
    }
  }

  // Fallback: treat as a person / seller display name (e.g., Facebook Marketplace name).
  const cleanName = trimmed.replace(/^@+/, '').slice(0, 120).trim();
  if (cleanName.length < 2) return null;
  return {
    kind: 'name',
    name: cleanName,
  };
}

/**
 * Generates bounded candidate username slugs from a full name (e.g. "David Chen" ->
 * ["davidchen", "david.chen", "david_chen"]). Used only as low-confidence discovery
 * candidates when a Marketplace buyer only has a name.
 */
export function candidateHandlesFromName(name: string): string[] {
  const parts = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return [];
  const joined = parts.join('');
  const dotted = parts.join('.');
  const underscored = parts.join('_');
  const candidates = [joined, dotted, underscored].filter((c) => c.length >= 5 && c.length <= 30);
  return Array.from(new Set(candidates));
}

export type PaymentCheckKind = 'PAYID_EMAIL' | 'PAYID_PHONE' | 'BANK_ACCOUNT' | 'CRYPTO_WALLET';

/**
 * Classifies a raw payment string pasted from Messenger / DMs (email, phone, BSB+acct,
 * or crypto address) so we can check all compatible scam-report identifier kinds.
 */
export function inferPaymentIdentifierCandidates(
  raw: string,
): Array<{ kind: 'PAYID_EMAIL' | 'PAYPAL_EMAIL' | 'PAYID_PHONE' | 'PHONE' | 'BANK_ACCOUNT' | 'CRYPTO_WALLET'; value: string }> {
  const value = (raw ?? '').trim();
  if (!value) return [];

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return [
      { kind: 'PAYID_EMAIL', value },
      { kind: 'PAYPAL_EMAIL', value },
    ];
  }

  if (/^(?:0x[a-fA-F0-9]{20,}|[13bc1][a-zA-Z0-9]{24,})$/.test(value) && !/\s/.test(value)) {
    return [{ kind: 'CRYPTO_WALLET', value }];
  }

  const digits = value.replace(/\D/g, '');
  // Australian BSB (6) + acct (4-10) when formatted with spaces/hyphens and not starting with +/04
  if (digits.length >= 10 && digits.length <= 16 && !value.startsWith('+') && !digits.startsWith('04') && !digits.startsWith('614')) {
    return [
      { kind: 'BANK_ACCOUNT', value },
      { kind: 'PAYID_PHONE', value },
      { kind: 'PHONE', value },
    ];
  }

  if (digits.length >= 9 && digits.length <= 15) {
    return [
      { kind: 'PAYID_PHONE', value },
      { kind: 'PHONE', value },
    ];
  }

  return [];
}

/** Build `/references?q=...` URL for in-place lookups on the main References page. */
export function referencesSearchHref(params: {
  q?: string | null;
  location?: string | null;
  fb?: string | null;
  handle?: string | null;
}): string {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set('q', params.q.trim());
  if (params.location?.trim()) query.set('location', params.location.trim());
  if (params.fb?.trim()) query.set('fb', params.fb.trim());
  if (params.handle?.trim()) query.set('handle', params.handle.trim());
  const qs = query.toString();
  return `/references${qs ? `?${qs}` : ''}`;
}

/** Build `/references/check` URL with optional query context (legacy redirect shim). */
export function referenceCheckHref(params: {
  q?: string | null;
  location?: string | null;
  fb?: string | null;
  handle?: string | null;
}): string {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set('q', params.q.trim());
  if (params.location?.trim()) query.set('location', params.location.trim());
  if (params.fb?.trim()) query.set('fb', params.fb.trim());
  if (params.handle?.trim()) query.set('handle', params.handle.trim());
  const qs = query.toString();
  return `/references/check${qs ? `?${qs}` : ''}`;
}

export interface SmartCheckInput {
  query: string;
  facebookUrl: string | null;
  paymentDetail: string | null;
  psaCertNumber: string | null;
  askingPrice: string | null;
  dmText: string | null;
}

const URL_IN_TEXT_RE =
  /\b(?:https?:\/\/)?(?:www\.|m\.|mbasic\.)?(?:facebook\.com|fb\.com|instagram\.com|instagr\.am|ebay\.[a-z.]+|whatnot\.com|tiktok\.com|x\.com|twitter\.com|youtube\.com)\/[^\s<>()]+/i;
const EMAIL_IN_TEXT_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const AU_BSB_ACCT_RE = /\b\d{3}[-\s]?\d{3}\s+\d{4,10}\b/;
const PHONE_IN_TEXT_RE = /(?:\+\d{1,3}[\s.-]?)?\b0?4\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/;
const CRYPTO_IN_TEXT_RE = /\b(?:0x[a-fA-F0-9]{20,}|bc1[a-zA-Z0-9]{25,})\b/;
const PSA_LABELED_CERT_RE = /\b(?:psa|cert(?:ificate)?)\s*(?:#|no\.?|number)?\s*[:#-]?\s*(\d{7,10})\b/i;
const PRICE_IN_TEXT_RE = /\$\s*(\d{2,6}(?:,\d{3})*(?:\.\d{1,2})?)\b/;
const HANDLE_IN_TEXT_RE = /(?:^|[\s(])@([a-zA-Z0-9._]{3,30})\b/;

/**
 * Parses a single-box user paste (profile URL, `@handle`, seller name, PayID/BSB,
 * PSA cert #, or a full Messenger/Instagram DM) into structured fields automatically
 * so buyers never have to fill out a multi-field form.
 */
export function parseSmartCheckInput(raw: string): SmartCheckInput {
  const text = (raw ?? '').trim();
  if (!text) {
    return {
      query: '',
      facebookUrl: null,
      paymentDetail: null,
      psaCertNumber: null,
      askingPrice: null,
      dmText: null,
    };
  }

  // Fast path: direct profile URL
  const directUrl = tryParseUrl(text);
  if (directUrl && !/\s/.test(text)) {
    const parsed = parseReferenceLookupInput(text);
    return {
      query: text,
      facebookUrl: parsed?.kind === 'handle' && parsed.platform === 'facebook' ? parsed.sourceUrl : null,
      paymentDetail: null,
      psaCertNumber: null,
      askingPrice: null,
      dmText: null,
    };
  }

  // Fast path: pure PSA cert like "172722881" or "PSA 172722881"
  const pureCert = text.match(/^(?:psa\s*)?#?(\d{7,10})$/i);
  if (pureCert?.[1]) {
    return {
      query: `PSA #${pureCert[1]}`,
      facebookUrl: null,
      paymentDetail: null,
      psaCertNumber: pureCert[1],
      askingPrice: null,
      dmText: null,
    };
  }

  // Fast path: pure payment identifier (email, BSB+acct, phone, crypto)
  const paymentOnly =
    !/\n/.test(text) &&
    text.length <= 64 &&
    (EMAIL_IN_TEXT_RE.test(text) && !/\s/.test(text) ||
      CRYPTO_IN_TEXT_RE.test(text) && !/\s/.test(text) ||
      /^(?:\+\d{1,3}[\s.-]?)?0?4\d{2}[\s.-]?\d{3}[\s.-]?\d{3}$/.test(text) ||
      /^\d{3}[-\s]?\d{3}[\s-]+\d{4,10}$/.test(text));
  if (paymentOnly) {
    return {
      query: text,
      facebookUrl: null,
      paymentDetail: text,
      psaCertNumber: null,
      askingPrice: null,
      dmText: null,
    };
  }

  // Multi-word or pasted DM block: extract embedded signals cleanly
  const embeddedUrl = text.match(URL_IN_TEXT_RE)?.[0] ?? null;
  const parsedEmbeddedUrl = embeddedUrl ? parseReferenceLookupInput(embeddedUrl) : null;
  const facebookUrl =
    parsedEmbeddedUrl?.kind === 'handle' && parsedEmbeddedUrl.platform === 'facebook'
      ? parsedEmbeddedUrl.sourceUrl
      : null;

  const paymentDetail =
    text.match(EMAIL_IN_TEXT_RE)?.[0] ??
    text.match(AU_BSB_ACCT_RE)?.[0] ??
    text.match(PHONE_IN_TEXT_RE)?.[0] ??
    text.match(CRYPTO_IN_TEXT_RE)?.[0] ??
    null;

  const psaCertNumber = text.match(PSA_LABELED_CERT_RE)?.[1] ?? null;
  const askingPriceMatch = text.match(PRICE_IN_TEXT_RE)?.[1]?.replace(/,/g, '') ?? null;
  const embeddedHandle = text.match(HANDLE_IN_TEXT_RE)?.[1] ?? null;

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const looksLikeDm =
    text.includes('\n') ||
    wordCount >= 6 ||
    text.length >= 45 ||
    Boolean(askingPriceMatch && wordCount >= 3);

  const primaryQuery =
    embeddedUrl ??
    (embeddedHandle ? `@${embeddedHandle}` : null) ??
    (!looksLikeDm ? text : paymentDetail ?? (psaCertNumber ? `PSA #${psaCertNumber}` : text.slice(0, 60)));

  return {
    query: primaryQuery,
    facebookUrl,
    paymentDetail,
    psaCertNumber,
    askingPrice: looksLikeDm ? askingPriceMatch : null,
    dmText: looksLikeDm ? text : null,
  };
}
