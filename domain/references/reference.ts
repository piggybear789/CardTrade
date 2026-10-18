// domain/references/reference.ts
//
// References (0155): the pure rules for a vouch. A reference is a positive,
// structured attestation that the voucher personally dealt with the target:
// where (platform), what happened (role), and roughly when (month). It goes
// LIVE immediately. There is no rating, no negative reference, and no free
// text on a quick vouch — bad experiences are scam reports, not references.
//
// Pure: no Supabase, React or service imports.

import { isValidHandle, normalizeHandle, platformBySlug } from '@/domain/social/socialLinks';

/** Where a deal can have happened. The `noditto` value is reserved for the UI's own records. */
export const REFERENCE_PLATFORMS = [
  { slug: 'instagram', label: 'Instagram' },
  { slug: 'facebook', label: 'Facebook' },
  { slug: 'discord', label: 'Discord' },
  { slug: 'ebay', label: 'eBay' },
  { slug: 'whatnot', label: 'Whatnot' },
  { slug: 'in-person', label: 'In person' },
  { slug: 'other', label: 'Somewhere else' },
] as const;

export type ReferencePlatform = (typeof REFERENCE_PLATFORMS)[number]['slug'];

export const REFERENCE_ROLES = [
  { slug: 'BOUGHT', label: 'Bought from them' },
  { slug: 'SOLD', label: 'Sold to them' },
  { slug: 'TRADED', label: 'Traded with them' },
] as const;

export type ReferenceRole = (typeof REFERENCE_ROLES)[number]['slug'];

export const NEGATIVE_CATEGORIES = [
  { slug: 'NEVER_ARRIVED', label: 'Item never arrived' },
  { slug: 'NOT_AS_DESCRIBED', label: 'Fake or not as described' },
  { slug: 'SWITCHED', label: 'Item was switched' },
  { slug: 'PAYMENT', label: 'Payment problem' },
  { slug: 'OTHER', label: 'Something else' },
] as const;

export type NegativeCategory = (typeof NEGATIVE_CATEGORIES)[number]['slug'];
export type ReferenceSentiment = 'POSITIVE' | 'NEGATIVE';

export function negativeCategoryLabel(slug: string | null | undefined): string | null {
  return NEGATIVE_CATEGORIES.find((c) => c.slug === slug)?.label ?? null;
}

/** Platforms a social claim (searchable handle) can live on. Mirrors the 0155 CHECK. */
export const CLAIM_PLATFORMS = ['instagram', 'facebook', 'x', 'youtube', 'tiktok', 'discord'] as const;
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
  return REFERENCE_PLATFORMS.find((p) => p.slug === slug)?.label ?? platformBySlug(slug)?.label ?? slug;
}

export function roleLabel(role: string): string {
  return REFERENCE_ROLES.find((r) => r.slug === role)?.label ?? role;
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
  | { kind: 'claim'; claimId: string };

export interface GiveReferenceInput {
  target: ReferenceTargetInput;
  platform: string;
  role: string;
  /** `YYYY-MM`; defaults to the current month. */
  occurredMonth?: string | null;
  /** Defaults to POSITIVE. A NEGATIVE experience publishes instantly too. */
  sentiment?: ReferenceSentiment;
  /** Required when NEGATIVE. */
  category?: string | null;
  /** Optional public comment on a NEGATIVE experience (max 500 chars). Ignored for POSITIVE. */
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
        sentiment: ReferenceSentiment;
        category: NegativeCategory | null;
        comment: string | null;
      };
    }
  | { ok: false; message: string; field: 'target' | 'platform' | 'role' | 'occurredMonth' | 'category' | 'comment' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateGiveReference(input: GiveReferenceInput): GiveReferenceValidation {
  const target = input?.target;
  if (
    !target ||
    (target.kind !== 'profile' && target.kind !== 'claim') ||
    typeof (target.kind === 'profile' ? target.profileId : target.claimId) !== 'string' ||
    !UUID_RE.test((target.kind === 'profile' ? target.profileId : target.claimId) as string)
  ) {
    return { ok: false, message: 'Choose who this reference is for.', field: 'target' };
  }
  if (!isReferencePlatform(input.platform)) {
    return { ok: false, message: 'Choose where you dealt with them.', field: 'platform' };
  }
  if (!isReferenceRole(input.role)) {
    return { ok: false, message: 'Choose what happened in the deal.', field: 'role' };
  }
  const occurredMonth = normalizeOccurredMonth(input.occurredMonth);
  if (!occurredMonth) {
    return { ok: false, message: 'Choose a month in the past.', field: 'occurredMonth' };
  }
  const sentiment: ReferenceSentiment = input.sentiment === 'NEGATIVE' ? 'NEGATIVE' : 'POSITIVE';
  let category: NegativeCategory | null = null;
  let comment: string | null = null;
  if (sentiment === 'NEGATIVE') {
    if (
      typeof input.category !== 'string' ||
      !(NEGATIVE_CATEGORIES as readonly { slug: string }[]).some((c) => c.slug === input.category)
    ) {
      return { ok: false, message: 'Choose what happened.', field: 'category' };
    }
    category = input.category as NegativeCategory;
    comment = typeof input.comment === 'string' ? input.comment.trim() || null : null;
    if (comment && comment.length > 500) {
      return { ok: false, message: 'Keep it to 500 characters or fewer.', field: 'comment' };
    }
  }
  return {
    ok: true,
    value: { target, platform: input.platform, role: input.role, occurredMonth, sentiment, category, comment },
  };
}

/** A claim handle, normalised the way `social_links` stores it, or null when invalid. */
export function normalizeClaimHandle(platform: string, raw: string): string | null {
  if (!isClaimPlatform(platform)) return null;
  const handle = normalizeHandle(raw ?? '');
  return isValidHandle(handle) ? handle : null;
}

/** Max references one member may give per day. Generous for humans, useless for rings. */
export const REFERENCES_PER_DAY = 20;
