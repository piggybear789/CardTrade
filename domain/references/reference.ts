// domain/references/reference.ts
//
// References (0155): the pure rules for sharing an experience. An experience
// records who (profile, claim, or handle), where (platform), what role
// (Bought / Sold / Traded), sentiment (Positive / Negative), and an optional
// written note in the member's own words. Both positive and negative
// experiences go LIVE immediately and are tied to the author's verified ID.
//
// Pure: no Supabase, React or service imports.

import { isValidHandle, normalizeHandle, platformBySlug } from '@/domain/social/socialLinks';

/** Where a deal can have happened. `noditto` is reserved for completed escrow deals. */
export const REFERENCE_PLATFORMS = [
  { slug: 'instagram', label: 'Instagram', shortLabel: 'IG' },
  { slug: 'facebook', label: 'Facebook', shortLabel: 'FB' },
  { slug: 'discord', label: 'Discord', shortLabel: 'Discord' },
  { slug: 'ebay', label: 'eBay', shortLabel: 'eBay' },
  { slug: 'whatnot', label: 'Whatnot', shortLabel: 'Whatnot' },
  { slug: 'other', label: 'Other', shortLabel: 'Other' },
] as const;

export type ReferencePlatform = (typeof REFERENCE_PLATFORMS)[number]['slug'];

export const REFERENCE_ROLES = [
  { slug: 'BOUGHT', label: 'Bought from them', shortLabel: 'Bought' },
  { slug: 'SOLD', label: 'Sold to them', shortLabel: 'Sold' },
  { slug: 'TRADED', label: 'Traded with them', shortLabel: 'Traded' },
] as const;

export type ReferenceRole = (typeof REFERENCE_ROLES)[number]['slug'];

export const NEGATIVE_CATEGORIES = [
  { slug: 'NEVER_ARRIVED', label: 'Item never arrived' },
  { slug: 'NOT_AS_DESCRIBED', label: 'Not as described' },
  { slug: 'SWITCHED', label: 'Item was switched' },
  { slug: 'PAYMENT', label: 'Payment issue' },
  { slug: 'OTHER', label: 'Other issue' },
] as const;

export type NegativeCategory = (typeof NEGATIVE_CATEGORIES)[number]['slug'];
export type ReferenceSentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';

export const REFERENCE_SENTIMENTS = [
  { slug: 'POSITIVE', label: 'Good' },
  { slug: 'NEUTRAL', label: 'So-so' },
  { slug: 'NEGATIVE', label: 'Bad' },
] as const;

export function negativeCategoryLabel(slug: string | null | undefined): string | null {
  return NEGATIVE_CATEGORIES.find((c) => c.slug === slug)?.label ?? null;
}

/** Platforms a social claim (searchable handle) can live on. Mirrors the 0155/0156 CHECK. */
export const CLAIM_PLATFORMS = ['instagram', 'facebook', 'x', 'youtube', 'tiktok', 'discord', 'ebay'] as const;
export type ClaimPlatform = (typeof CLAIM_PLATFORMS)[number];

export function isReferencePlatform(value: unknown): value is ReferencePlatform {
  return (
    typeof value === 'string' &&
    (REFERENCE_PLATFORMS as readonly { slug: string }[]).some((p) => p.slug === value)
  );
}

export function isReferenceRole(value: unknown): value is ReferenceRole {
  return value === 'BOUGHT' || value === 'SOLD' || value === 'TRADED';
}

export function isClaimPlatform(value: unknown): value is ClaimPlatform {
  return typeof value === 'string' && (CLAIM_PLATFORMS as readonly string[]).includes(value);
}

export function platformLabel(slug: string): string {
  if (slug === 'noditto') return 'NoDitto';
  return REFERENCE_PLATFORMS.find((p) => p.slug === slug)?.label ?? platformBySlug(slug)?.label ?? slug;
}

export function roleLabel(role: string): string {
  return REFERENCE_ROLES.find((r) => r.slug === role)?.label ?? role;
}

export function roleShortLabel(role: string): string {
  return REFERENCE_ROLES.find((r) => r.slug === role)?.shortLabel ?? role;
}

/** `YYYY-MM` for the current month, or a validated input month not in the future. */
export function normalizeOccurredMonth(value: unknown, now = new Date()): string | null {
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (value === undefined || value === null || value === '') return `${current}-01`;
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  if (match[2] < '01' || match[2] > '12') return null;
  if (`${match[1]}-${match[2]}` > current) return null;
  if (Number(match[1]) < 2015) return null;
  return `${match[1]}-${match[2]}-01`;
}

/** Display form of a stored occurred_month date: `Mar 2026`. */
export function formatOccurredMonth(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export type ReferenceTargetInput =
  | { kind: 'profile'; profileId: string }
  | { kind: 'claim'; claimId: string }
  | { kind: 'handle'; handle: string };

export interface GiveReferenceInput {
  target: ReferenceTargetInput;
  platform: string;
  role: string;
  /** `YYYY-MM`; defaults to the current month. */
  occurredMonth?: string | null;
  /** 1..5 star rating; derives sentiment when provided. */
  rating?: number | null;
  /** Defaults to POSITIVE. Both POSITIVE and NEGATIVE publish immediately. */
  sentiment?: ReferenceSentiment;
  /** Optional category when NEGATIVE (defaults to OTHER). */
  category?: string | null;
  /** Public written experience in words (max 500 chars), supported on both sentiments. */
  comment?: string | null;
}

export type GiveReferenceValidation =
  | {
      ok: true;
      value: {
        target: ReferenceTargetInput;
        platform: ReferencePlatform;
        role: ReferenceRole;
        occurredMonth: string;
        rating: number;
        sentiment: ReferenceSentiment;
        category: NegativeCategory | null;
        comment: string | null;
      };
    }
  | {
      ok: false;
      message: string;
      field: 'target' | 'platform' | 'role' | 'occurredMonth' | 'rating' | 'category' | 'comment';
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function validateGiveReference(input: GiveReferenceInput): GiveReferenceValidation {
  const target = input?.target;
  if (!target || typeof target !== 'object') {
    return { ok: false, message: 'Choose who this reference is for.', field: 'target' };
  }
  if (target.kind === 'profile') {
    if (typeof target.profileId !== 'string' || !UUID_RE.test(target.profileId)) {
      return { ok: false, message: 'Choose who this reference is for.', field: 'target' };
    }
  } else if (target.kind === 'claim') {
    if (typeof target.claimId !== 'string' || !UUID_RE.test(target.claimId)) {
      return { ok: false, message: 'Choose who this reference is for.', field: 'target' };
    }
  } else if (target.kind === 'handle') {
    const cleaned = normalizeHandle(target.handle ?? '');
    if (!isValidHandle(cleaned)) {
      return { ok: false, message: 'Enter a valid handle.', field: 'target' };
    }
  } else {
    return { ok: false, message: 'Choose who this reference is for.', field: 'target' };
  }

  if (!isReferencePlatform(input.platform)) {
    return { ok: false, message: 'Choose where you did the deal.', field: 'platform' };
  }
  if (!isReferenceRole(input.role)) {
    return { ok: false, message: 'Choose whether you bought, sold, or traded.', field: 'role' };
  }
  const occurredMonth = normalizeOccurredMonth(input.occurredMonth);
  if (!occurredMonth) {
    return { ok: false, message: 'Choose a valid month.', field: 'occurredMonth' };
  }
  let rating = 5;
  if (input.rating !== undefined && input.rating !== null) {
    if (
      typeof input.rating !== 'number' ||
      !Number.isInteger(input.rating) ||
      input.rating < 1 ||
      input.rating > 5
    ) {
      return { ok: false, message: 'Pick a rating from 1 to 5.', field: 'rating' };
    }
    rating = input.rating;
  } else if (input.sentiment === 'NEGATIVE') {
    rating = 1;
  } else if (input.sentiment === 'NEUTRAL') {
    rating = 3;
  }
  const sentiment: ReferenceSentiment =
    input.rating !== undefined && input.rating !== null
      ? rating >= 4
        ? 'POSITIVE'
        : rating === 3
          ? 'NEUTRAL'
          : 'NEGATIVE'
      : input.sentiment === 'NEGATIVE'
        ? 'NEGATIVE'
        : input.sentiment === 'NEUTRAL'
          ? 'NEUTRAL'
          : 'POSITIVE';
  let category: NegativeCategory | null = null;
  if (sentiment === 'NEGATIVE') {
    if (
      typeof input.category === 'string' &&
      (NEGATIVE_CATEGORIES as readonly { slug: string }[]).some((c) => c.slug === input.category)
    ) {
      category = input.category as NegativeCategory;
    } else {
      category = 'OTHER';
    }
  }

  const rawComment = typeof input.comment === 'string' ? input.comment.trim() : '';
  const comment = rawComment.length > 0 ? rawComment : null;
  if (comment && comment.length > 500) {
    return { ok: false, message: 'Keep your note to 500 characters or fewer.', field: 'comment' };
  }

  const normalizedTarget: ReferenceTargetInput =
    target.kind === 'handle' ? { kind: 'handle', handle: normalizeHandle(target.handle) } : target;

  return {
    ok: true,
    value: {
      target: normalizedTarget,
      platform: input.platform,
      role: input.role,
      occurredMonth,
      rating,
      sentiment,
      category,
      comment,
    },
  };
}

/** A claim handle, normalised the way `social_links` stores it, or null when invalid. */
export function normalizeClaimHandle(platform: string, raw: string): string | null {
  if (!isClaimPlatform(platform)) return null;
  const handle = normalizeHandle(raw ?? '');
  return isValidHandle(handle) ? handle : null;
}

/** Map any deal platform to a valid `social_claims.platform` column value. */
export function claimPlatformForDealPlatform(platform: string): ClaimPlatform {
  if (isClaimPlatform(platform)) return platform;
  return 'instagram';
}

/** Max references one member may give per day. Generous for humans, useless for rings. */
export const REFERENCES_PER_DAY = 20;
