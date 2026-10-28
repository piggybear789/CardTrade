// domain/references/reference.ts
//
// References (0155): the pure rules for sharing an experience. An experience
// records who (profile, claim, or handle), where (platform), what role
// (Bought / Sold / Traded), sentiment (Positive / Negative), and an optional
// written note in the member's own words. Both positive and negative
// experiences go LIVE immediately and are tied to the author's verified ID.
//
// Pure: no Supabase, React or service imports.

import { normalizeHandle, platformBySlug } from '@/domain/social/socialLinks';

/** Where a deal can have happened. `noditto` is reserved for completed escrow deals. */
export const REFERENCE_PLATFORMS = [
  { slug: 'instagram', label: 'Instagram' },
  { slug: 'facebook', label: 'Facebook' },
  { slug: 'discord', label: 'Discord' },
  { slug: 'ebay', label: 'eBay' },
  { slug: 'whatnot', label: 'Whatnot' },
  { slug: 'other', label: 'Other' },
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

export function isNegativeCategory(value: unknown): value is NegativeCategory {
  return NEGATIVE_CATEGORIES.some((c) => c.slug === value);
}

/** The earliest year a deal can be dated (`normalizeOccurredMonth`). */
export const FIRST_DEAL_YEAR = 2015;

/** Platforms a social claim (searchable handle) can live on. Mirrors the 0162 CHECK. */
export const CLAIM_PLATFORMS = ['instagram', 'facebook', 'x', 'youtube', 'tiktok', 'discord', 'ebay', 'whatnot'] as const;
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

/**
 * The longest username each platform allows, rounded up where a platform is vague, so a
 * real handle is never refused. A handle past it is not a handle on that platform.
 */
const CLAIM_HANDLE_MAX: Record<ClaimPlatform, number> = {
  instagram: 30,
  facebook: 50,
  x: 15,
  youtube: 30,
  tiktok: 24,
  discord: 32,
  ebay: 64,
  whatnot: 40,
};

/** The longest handle accepted when the platform is not known yet. */
const ANY_HANDLE_MAX = 64;

/**
 * Letters, digits, `.`, `_` and `-`: every platform's username alphabet, and nothing that
 * could pass for a sentence, a link or markup on a public page. eBay alone also allows `*`.
 */
const HANDLE_CHARS = /^[A-Za-z0-9._-]+$/;
const EBAY_HANDLE_CHARS = /^[A-Za-z0-9._*-]+$/;

/** Whether `handle` (no `@`) could be a username on `platform`, or on any platform when null. */
export function isValidClaimHandle(platform: ClaimPlatform | null, handle: string): boolean {
  const max = platform ? CLAIM_HANDLE_MAX[platform] : ANY_HANDLE_MAX;
  if (handle.length === 0 || handle.length > max) return false;
  return (platform === 'ebay' ? EBAY_HANDLE_CHARS : HANDLE_CHARS).test(handle);
}

/** A NoDitto display name shown where a handle would be. Never with a leading `@`: it is not one. */
export function displayNameLabel(displayName: string): string {
  return displayName.trim().replace(/^@+/, '');
}

export function platformLabel(slug: string): string {
  if (slug === 'noditto') return 'NoDitto';
  return REFERENCE_PLATFORMS.find((p) => p.slug === slug)?.label ?? platformBySlug(slug)?.label ?? slug;
}

export function roleLabel(role: string): string {
  return REFERENCE_ROLES.find((r) => r.slug === role)?.label ?? role;
}

function utcMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** UTC+14, the first time zone into each new month. */
const EARLIEST_ZONE_MS = 14 * 60 * 60 * 1000;

/** `YYYY-MM-01` for the current month, or a validated input month not in the future. */
export function normalizeOccurredMonth(value: unknown, now = new Date()): string | null {
  if (value === undefined || value === null || value === '') return `${utcMonth(now)}-01`;
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  if (match[2] < '01' || match[2] > '12') return null;
  // The future starts after the newest month begun ANYWHERE: a member in Sydney on the
  // morning of the 1st is already in a month the server's UTC clock has not reached.
  if (`${match[1]}-${match[2]}` > utcMonth(new Date(now.getTime() + EARLIEST_ZONE_MS))) return null;
  if (Number(match[1]) < FIRST_DEAL_YEAR) return null;
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
  /** A handle with no claim row yet. `platform` is where the account lives. */
  | { kind: 'handle'; handle: string; platform: string };

/** A target that passed validation: a handle's platform is a known claim platform. */
export type ValidReferenceTarget =
  | { kind: 'profile'; profileId: string }
  | { kind: 'claim'; claimId: string }
  | { kind: 'handle'; handle: string; platform: ClaimPlatform };

/** What a reference says, apart from who it is for: the part its author can edit later. */
export interface ReferenceDetailsInput {
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

export interface GiveReferenceInput extends ReferenceDetailsInput {
  target: ReferenceTargetInput;
}

export interface ReferenceDetails {
  platform: ReferencePlatform;
  role: ReferenceRole;
  occurredMonth: string;
  rating: number;
  sentiment: ReferenceSentiment;
  category: NegativeCategory | null;
  comment: string | null;
}

type ReferenceDetailsField = 'platform' | 'role' | 'occurredMonth' | 'rating' | 'category' | 'comment';

export type ReferenceDetailsValidation =
  | { ok: true; value: ReferenceDetails }
  | { ok: false; message: string; field: ReferenceDetailsField };

export type GiveReferenceValidation =
  | { ok: true; value: ReferenceDetails & { target: ValidReferenceTarget } }
  | { ok: false; message: string; field: 'target' | ReferenceDetailsField };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

function validateTarget(
  target: ReferenceTargetInput | null | undefined,
): { ok: true; value: ValidReferenceTarget } | { ok: false; message: string; field: 'target' | 'platform' } {
  const unknownTarget = { ok: false as const, message: 'Choose who this reference is for.', field: 'target' as const };
  if (!target || typeof target !== 'object') return unknownTarget;
  if (target.kind === 'profile') {
    return isUuid(target.profileId) ? { ok: true, value: { kind: 'profile', profileId: target.profileId } } : unknownTarget;
  }
  if (target.kind === 'claim') {
    return isUuid(target.claimId) ? { ok: true, value: { kind: 'claim', claimId: target.claimId } } : unknownTarget;
  }
  if (target.kind === 'handle') {
    const platform = target.platform;
    if (!isClaimPlatform(platform)) {
      return { ok: false, message: 'Choose the platform this account is on.', field: 'platform' };
    }
    const handle = normalizeHandle(target.handle ?? '');
    if (!isValidClaimHandle(platform, handle)) {
      return { ok: false, message: 'Enter a valid handle.', field: 'target' };
    }
    return { ok: true, value: { kind: 'handle', handle, platform } };
  }
  return unknownTarget;
}

export function validateReferenceDetails(input: ReferenceDetailsInput): ReferenceDetailsValidation {
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
      ? sentimentForRating(rating)
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
  // Code points, as the SQL CHECK counts (`char_length`), so an emoji is one character.
  if (comment && Array.from(comment).length > 500) {
    return { ok: false, message: 'Keep your note to 500 characters or fewer.', field: 'comment' };
  }

  return {
    ok: true,
    value: { platform: input.platform, role: input.role, occurredMonth, rating, sentiment, category, comment },
  };
}

export function validateGiveReference(input: GiveReferenceInput): GiveReferenceValidation {
  const target = validateTarget(input?.target);
  if (!target.ok) return target;
  const details = validateReferenceDetails(input);
  if (!details.ok) return details;
  return { ok: true, value: { ...details.value, target: target.value } };
}

/** A claim handle, normalised the way `social_links` stores it, or null when invalid. */
export function normalizeClaimHandle(platform: string, raw: string): string | null {
  if (!isClaimPlatform(platform)) return null;
  const handle = normalizeHandle(raw ?? '');
  return isValidClaimHandle(platform, handle) ? handle : null;
}

/** Max references one member may give per day. Generous for humans, useless for rings. */
export const REFERENCES_PER_DAY = 20;

/**
 * What a 1..5 rating says: 4–5 good, 3 so-so, 1–2 bad. The ONE mapping, for a reference
 * and for a NoDitto review alike, so a 1-star review is never read as a vouch.
 */
export function sentimentForRating(rating: number): ReferenceSentiment {
  if (rating >= 4) return 'POSITIVE';
  if (rating === 3) return 'NEUTRAL';
  return 'NEGATIVE';
}

/** How many different people left each kind of experience. */
export interface PeopleTally {
  positive: number;
  neutral: number;
  negative: number;
}

/** One experience of someone: a reference, or a NoDitto review read through `sentimentForRating`. */
export interface PeopleTallyEntry {
  /** Who the experience is about. */
  target: string;
  /** Who had it. */
  person: string;
  sentiment: ReferenceSentiment;
}

/**
 * PEOPLE, NEVER DEALS OR POSTS: the one way every reference count is computed (a page's
 * headline, a planet's size, a search result, the landing list). A person counts once
 * per kind of experience however many deals, references or reviews they log, and a
 * reference and a review from the same person for the same kind are one person. The
 * kinds are kept apart: a bad experience never nets off a good one, and a so-so one is
 * neither.
 */
export function tallyPeople(entries: Iterable<PeopleTallyEntry>): Map<string, PeopleTally> {
  const seen = new Set<string>();
  const tally = new Map<string, PeopleTally>();
  for (const { target, person, sentiment } of entries) {
    if (target === person) continue;
    const key = `${target}\u0000${person}\u0000${sentiment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = tally.get(target) ?? { positive: 0, neutral: 0, negative: 0 };
    if (sentiment === 'POSITIVE') entry.positive += 1;
    else if (sentiment === 'NEUTRAL') entry.neutral += 1;
    else entry.negative += 1;
    tally.set(target, entry);
  }
  return tally;
}

/**
 * Whether posting again for `occurredMonth` records ANOTHER deal (`YYYY-MM-01` dates).
 * Only a month after every month already counted is one: `dealsThrough` never goes back
 * when the reference's month is edited, so rewinding the month and posting again cannot
 * raise the count. At most one deal per calendar month.
 */
export function isAnotherDeal(
  occurredMonth: string,
  existing: { occurredMonth: string; dealsThrough: string | null },
): boolean {
  const through =
    existing.dealsThrough && existing.dealsThrough > existing.occurredMonth
      ? existing.dealsThrough
      : existing.occurredMonth;
  return occurredMonth > through;
}

/** The month counted through after a reference's month is set to `occurredMonth`. */
export function dealsThroughAfter(occurredMonth: string, dealsThrough: string | null): string {
  return dealsThrough && dealsThrough > occurredMonth ? dealsThrough : occurredMonth;
}

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The person a profile belongs to, chosen exactly as `cardtrade.person_key_for` (0162)
 * chooses it, because the claim trigger and `giveReference` must name the same person:
 * a document key first, then by kind and fingerprint in code-point order (the SQL sorts
 * `collate "C"`), else `profile:<id>`.
 */
export function pickPersonKey(
  profileId: string,
  rows: readonly { fingerprint: string; kind: string }[],
): string {
  const best = [...rows].sort(
    (a, b) =>
      Number(b.kind === 'document-id') - Number(a.kind === 'document-id') ||
      byCodePoint(a.kind, b.kind) ||
      byCodePoint(a.fingerprint, b.fingerprint),
  )[0];
  return best?.fingerprint ?? `profile:${profileId}`;
}
