'use server';

// lib/actions/references.ts
//
// References (0155): search, sharing / editing / withdrawing an experience, and claiming
// a handle. Everything writes through the service role, because `social_claims` and
// `member_references` carry no member grant; each action checks who is asking before it
// touches a row.
//
// Both positive and negative experiences go LIVE immediately and are linked
// to the author's verified identity.
//
// A HANDLE IS ALWAYS ON A PLATFORM. Nothing here finds a handle by its spelling alone:
// @john on Instagram and john on Discord are different people, and a reference left
// for one must never reach the other.

import { createHmac, randomInt } from 'node:crypto';
import { revalidatePath, unstable_cache, updateTag } from 'next/cache';

import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { withActionLog } from '@/lib/errors/withActionLog';
import { instagramBotHandle, isInstagramBotHandle } from '@/lib/instagram/botHandle';
import { getInstagramBotToken } from '@/lib/instagram/botToken';
import { REFERENCES_CACHE_TAG } from '@/lib/references/cacheTag';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { createNotification } from '@/lib/notifications/createNotification';
import { rateLimitIdentifier } from '@/lib/rateLimit';
import {
  handleClaimLimiter,
  referenceSearchLimiter,
  referenceUploadLimiter,
  referenceWriteLimiter,
} from '@/lib/rateLimiters';
import {
  createSignedReferenceUpload,
  existingReferenceImages,
} from '@/lib/storage/referenceImages';
import {
  HANDLE_CLAIM_EVIDENCE_BUCKET,
  REFERENCE_PROOF_BUCKET,
} from '@/lib/storage/referenceImagesShared';
import { satisfiesIdentityGate, type IdentityCheckStatus } from '@/domain/identity/identityGate';
import { claimAddress, type ReferenceAddress } from '@/domain/references/address';
import {
  REFERENCES_PER_DAY,
  REFERENCE_SENTIMENTS,
  displayNameLabel,
  isClaimPlatform,
  isUuid,
  normalizeClaimHandle,
  pickPersonKey,
  platformLabel,
  roleLabel,
  validateGiveReference,
  validateReferenceDetails,
  type ClaimPlatform,
  type GiveReferenceInput,
  type ReferenceDetailsInput,
  type ReferenceSentiment,
} from '@/domain/references/reference';
import { type ActionFailure, type ActionResult, fail, ok } from './result';

export type ReferenceError =
  | 'not-authenticated'
  | 'identity-unverified'
  | 'not-allowed'
  | 'self-reference'
  | 'rate-limited'
  | 'invalid-reference'
  | 'not-found'
  | 'persistence-error';

const SAVE_FAILED = "We couldn't save that. Please try again.";
const RATE_LIMITED = 'Too many attempts. Wait a minute and try again.';

/** One autofill suggestion: a member, or one unclaimed handle on its own platform. */
export interface ReferenceSuggestion {
  kind: 'profile' | 'claim';
  /** profiles.id when claimed, social_claims.id when not. */
  id: string;
  /** A member's claimed and dealt-on platforms; an unclaimed handle's one platform. */
  platforms: string[];
  /** `@handle`, or a member's display name when they have no claimed handle. */
  handle: string;
  /** Their page. */
  address: ReferenceAddress;
  /** NoDitto display name, or the claim's handle when unclaimed. */
  name: string;
  regionCode: string | null;
  avatarPath: string | null;
  /** How many people left a positive reference, NoDitto escrow reviews included. */
  referenceCount: number;
}

/** The target a ShareExperience form posts against. */
export interface ReferenceTargetDescriptor {
  kind: 'profile' | 'claim' | 'handle';
  /** profiles.id, social_claims.id, or the handle itself (no `@`) for a handle nobody has placed. */
  id: string;
  /** What the dialog calls them: `@handle`, or a member's display name. */
  handle: string;
  /** For `handle`: the platform the account is on, when the page knows it. Null otherwise. */
  platform: ClaimPlatform | null;
}

type Admin = ReturnType<typeof createAdminClient>;

async function personKeyFor(admin: Admin, profileId: string): Promise<string> {
  const { data } = await admin
    .from('identity_person_keys')
    .select('fingerprint, kind')
    .eq('profile_id', profileId);
  return pickPersonKey(profileId, data ?? []);
}

/** Why this member may not claim a handle, or null when they may. */
async function claimRefusal(admin: Admin, userId: string): Promise<ActionFailure<ReferenceError> | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('fraud_banned_at, closed_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) return fail('persistence-error', SAVE_FAILED);
  if (!data || data.fraud_banned_at || data.closed_at) {
    return fail('not-allowed', "This account can't claim handles.");
  }
  return null;
}

/** The one claim row for a handle on a platform, created unclaimed when there is none. */
async function findOrCreateClaim(
  admin: Admin,
  platform: ClaimPlatform,
  handle: string,
  createdBy: string,
): Promise<{ id: string; claimed_profile_id: string | null } | null> {
  const find = () =>
    admin
      .from('social_claims')
      .select('id, claimed_profile_id')
      .eq('platform', platform)
      .eq('handle_norm', handle.toLowerCase())
      .maybeSingle();

  const existing = await find();
  if (existing.data) return existing.data;
  if (existing.error) return null;

  const { data: created, error } = await admin
    .from('social_claims')
    .insert({ platform, handle, created_by: createdBy, claim_method: 'UNCLAIMED' })
    .select('id, claimed_profile_id')
    .maybeSingle();
  if (created) return created;
  // 23505: someone created the same row a moment earlier.
  if (error && error.code !== '23505') return null;
  return (await find()).data ?? null;
}

function sentimentLabel(sentiment: ReferenceSentiment): string {
  return REFERENCE_SENTIMENTS.find((s) => s.slug === sentiment)?.label ?? sentiment;
}

/** `text` as a literal inside an ILIKE pattern, so `%` and `_` match only themselves. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Refresh everywhere a reference shows. `updateTag` expires the cached graphs outright,
 * so the member who just wrote sees their change on the next render, never a stale copy.
 */
function revalidateReferences(targetProfileId: string | null): void {
  updateTag(REFERENCES_CACHE_TAG);
  revalidatePath('/references', 'layout');
  if (targetProfileId) revalidatePath(`/sellers/${targetProfileId}`);
}

// ---------------------------------------------------------------------------
// searchReferences
// ---------------------------------------------------------------------------

const SUGGESTION_LIMIT = 8;

interface ClaimMatch {
  id: string;
  platform: string;
  handle: string;
  claimed_profile_id: string | null;
}

/**
 * Autofill for `/references` and the header search. A member appears once, with every
 * platform they have a claimed handle or a reference on. An unclaimed handle appears on
 * its own platform, never merged with a same-spelled handle elsewhere. With no query:
 * the people and handles the most people have referenced lately.
 */
export const searchReferences = withActionLog('references.searchReferences', async function searchReferences(
  query: string,
): Promise<ActionResult<ReferenceSuggestion[], 'persistence-error' | 'rate-limited'>> {
  if (!(await referenceSearchLimiter.check(await rateLimitIdentifier(null))).allowed) {
    return fail('rate-limited', 'Too many searches. Wait a moment and try again.');
  }
  const needle = (query ?? '').trim().replace(/^@/, '').toLowerCase().slice(0, 64);
  if (!needle) {
    try {
      return ok(await cachedTopSuggestions());
    } catch {
      return fail('persistence-error', SAVE_FAILED);
    }
  }

  const admin = createAdminClient();
  const pattern = `%${likeLiteral(needle)}%`;
  const [claimResult, nameResult] = await Promise.all([
    admin
      .from('social_claims')
      .select('id, platform, handle, claimed_profile_id')
      .ilike('handle', pattern)
      .order('handle', { ascending: true })
      .limit(60),
    admin
      .from('profiles')
      .select('id')
      .ilike('display_name', pattern)
      .is('fraud_banned_at', null)
      .is('closed_at', null)
      .limit(40),
  ]);
  if (claimResult.error || nameResult.error) return fail('persistence-error', SAVE_FAILED);

  const suggestions = await buildSuggestions(
    admin,
    (nameResult.data ?? []).map((row) => row.id),
    claimResult.data ?? [],
    needle,
  );
  if (!suggestions) return fail('persistence-error', SAVE_FAILED);
  return ok(suggestions);
});

/**
 * The no-query suggestions, the `/references` landing list: the same for everyone, so
 * shared across requests, and expired with every other cached reference read. A failed
 * read throws rather than returning, so a failure is never cached.
 */
const cachedTopSuggestions = unstable_cache(
  async (): Promise<ReferenceSuggestion[]> => {
    const admin = createAdminClient();
    const top = await mostReferenced(admin);
    if (!top) throw new Error('[references] most-referenced read failed');
    let claims: ClaimMatch[] = [];
    if (top.claimIds.length > 0) {
      const { data, error } = await admin
        .from('social_claims')
        .select('id, platform, handle, claimed_profile_id')
        .in('id', top.claimIds);
      if (error) throw new Error(`[references] most-referenced claims: ${error.message}`);
      claims = data ?? [];
    }
    const suggestions = await buildSuggestions(admin, top.profileIds, claims, '');
    if (!suggestions) throw new Error('[references] most-referenced suggestions read failed');
    return suggestions;
  },
  ['references-top'],
  { tags: [REFERENCES_CACHE_TAG], revalidate: 300 },
);

/** The people and handles with the most distinct positive references among the latest ones. */
async function mostReferenced(admin: Admin): Promise<{ profileIds: string[]; claimIds: string[] } | null> {
  const [edges, reviews] = await Promise.all([
    admin
      .from('reference_edges_public')
      .select('voucher_id, target_profile_id, target_claim_id')
      .eq('sentiment', 'POSITIVE')
      .order('created_at', { ascending: false })
      .limit(2000),
    admin
      .from('reviews')
      .select('reviewer_id, reviewee_id')
      .order('created_at', { ascending: false })
      .limit(2000),
  ]);
  if (edges.error || reviews.error) return null;

  const people = new Map<string, Set<string>>();
  const add = (target: string, person: string) => {
    const set = people.get(target) ?? new Set<string>();
    set.add(person);
    people.set(target, set);
  };
  for (const edge of edges.data ?? []) {
    if (edge.target_profile_id) add(`p:${edge.target_profile_id}`, edge.voucher_id);
    else if (edge.target_claim_id) add(`c:${edge.target_claim_id}`, edge.voucher_id);
  }
  for (const review of reviews.data ?? []) add(`p:${review.reviewee_id}`, review.reviewer_id);

  const top = Array.from(people.entries())
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, SUGGESTION_LIMIT * 3)
    .map(([key]) => key);
  return {
    profileIds: top.filter((key) => key.startsWith('p:')).map((key) => key.slice(2)),
    claimIds: top.filter((key) => key.startsWith('c:')).map((key) => key.slice(2)),
  };
}

async function buildSuggestions(
  admin: Admin,
  namedProfileIds: string[],
  claims: readonly ClaimMatch[],
  needle: string,
): Promise<ReferenceSuggestion[] | null> {
  // The handle a member was found by, so a search for their Discord name shows it.
  const matchedHandle = new Map<string, ClaimMatch>();
  for (const claim of claims) {
    if (claim.claimed_profile_id && !matchedHandle.has(claim.claimed_profile_id)) {
      matchedHandle.set(claim.claimed_profile_id, claim);
    }
  }
  const profileIds = Array.from(new Set([...matchedHandle.keys(), ...namedProfileIds]));
  const unclaimed = claims.filter((claim) => !claim.claimed_profile_id);
  const unclaimedIds = unclaimed.map((claim) => claim.id);

  const none = { data: [], error: null };
  const [profiles, profileClaims, profileEdges, claimEdges, reviews] = await Promise.all([
    profileIds.length
      ? admin
          .from('profiles')
          .select('id, display_name, region_code, avatar_path')
          .in('id', profileIds)
          .is('fraud_banned_at', null)
          .is('closed_at', null)
      : Promise.resolve(none),
    profileIds.length
      ? admin
          .from('social_claims')
          .select('id, platform, handle, claimed_profile_id')
          .in('claimed_profile_id', profileIds)
          .order('claimed_at', { ascending: true })
      : Promise.resolve(none),
    profileIds.length
      ? admin
          .from('reference_edges_public')
          .select('voucher_id, target_profile_id, platform, sentiment')
          .in('target_profile_id', profileIds)
          .limit(5000)
      : Promise.resolve(none),
    unclaimedIds.length
      ? admin
          .from('reference_edges_public')
          .select('voucher_id, target_claim_id, sentiment')
          .in('target_claim_id', unclaimedIds)
          .limit(5000)
      : Promise.resolve(none),
    profileIds.length
      ? admin.from('reviews').select('reviewer_id, reviewee_id').in('reviewee_id', profileIds).limit(5000)
      : Promise.resolve(none),
  ]);
  if (profiles.error || profileClaims.error || profileEdges.error || claimEdges.error || reviews.error) {
    return null;
  }

  // People, not deals: one person counts once however many deals or references they log.
  const peopleFor = new Map<string, Set<string>>();
  const platformsFor = new Map<string, Set<string>>();
  const note = (map: Map<string, Set<string>>, key: string, value: string) => {
    const set = map.get(key) ?? new Set<string>();
    set.add(value);
    map.set(key, set);
  };
  const claimsOf = new Map<string, ClaimMatch[]>();
  for (const claim of (profileClaims.data ?? []) as ClaimMatch[]) {
    if (!claim.claimed_profile_id) continue;
    claimsOf.set(claim.claimed_profile_id, [...(claimsOf.get(claim.claimed_profile_id) ?? []), claim]);
    note(platformsFor, `p:${claim.claimed_profile_id}`, claim.platform);
  }
  for (const edge of (profileEdges.data ?? []) as { voucher_id: string; target_profile_id: string | null; platform: string; sentiment: string }[]) {
    if (!edge.target_profile_id) continue;
    note(platformsFor, `p:${edge.target_profile_id}`, edge.platform);
    if (edge.sentiment === 'POSITIVE') note(peopleFor, `p:${edge.target_profile_id}`, edge.voucher_id);
  }
  for (const review of (reviews.data ?? []) as { reviewer_id: string; reviewee_id: string }[]) {
    note(platformsFor, `p:${review.reviewee_id}`, 'noditto');
    note(peopleFor, `p:${review.reviewee_id}`, review.reviewer_id);
  }
  for (const edge of (claimEdges.data ?? []) as { voucher_id: string; target_claim_id: string | null; sentiment: string }[]) {
    if (edge.target_claim_id && edge.sentiment === 'POSITIVE') note(peopleFor, `c:${edge.target_claim_id}`, edge.voucher_id);
  }

  const score = (handle: string, name: string): number => {
    if (!needle) return 1;
    const h = handle.toLowerCase().replace(/^@/, '');
    const n = name.toLowerCase();
    if (h === needle || n === needle) return 0;
    if (h.startsWith(needle) || n.startsWith(needle)) return 1;
    if (h.includes(needle) || n.includes(needle)) return 2;
    return 3;
  };

  const ranked: (ReferenceSuggestion & { score: number })[] = [];
  for (const profile of (profiles.data ?? []) as {
    id: string;
    display_name: string;
    region_code: string | null;
    avatar_path: string | null;
  }[]) {
    const shown = matchedHandle.get(profile.id) ?? claimsOf.get(profile.id)?.[0];
    const name = displayNameLabel(profile.display_name);
    const handle = shown ? `@${shown.handle}` : name;
    ranked.push({
      kind: 'profile',
      id: profile.id,
      platforms: Array.from(platformsFor.get(`p:${profile.id}`) ?? []),
      handle,
      address: shown ? claimAddress(shown) : { slug: profile.id, on: null },
      name,
      regionCode: profile.region_code ?? null,
      avatarPath: profile.avatar_path ?? null,
      referenceCount: peopleFor.get(`p:${profile.id}`)?.size ?? 0,
      score: score(handle, name),
    });
  }
  for (const claim of unclaimed) {
    const handle = `@${claim.handle}`;
    ranked.push({
      kind: 'claim',
      id: claim.id,
      platforms: [claim.platform],
      handle,
      address: claimAddress(claim),
      name: claim.handle,
      regionCode: null,
      avatarPath: null,
      referenceCount: peopleFor.get(`c:${claim.id}`)?.size ?? 0,
      score: score(handle, claim.handle),
    });
  }

  return ranked
    .filter((suggestion) => needle || suggestion.referenceCount > 0)
    .sort(
      (a, b) =>
        a.score - b.score || b.referenceCount - a.referenceCount || a.handle.localeCompare(b.handle),
    )
    .slice(0, SUGGESTION_LIMIT)
    .map(({ score: _score, ...rest }) => rest);
}

// ---------------------------------------------------------------------------
// giveReference
// ---------------------------------------------------------------------------

/**
 * Share an experience (positive or negative) from an ID-verified member. Goes LIVE
 * immediately. Another reference for the same pair and sentiment updates the one
 * already there rather than adding a second.
 */
export const giveReference = withActionLog('references.giveReference', async function giveReference(
  input: GiveReferenceInput,
): Promise<ActionResult<{ referenceId: string; addedDeal: boolean }, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in to share your experience.');
  if (!(await referenceWriteLimiter.check(user.id)).allowed) return fail('rate-limited', RATE_LIMITED);

  const validation = validateGiveReference(input);
  if (!validation.ok) return fail('invalid-reference', validation.message, validation.field);
  const { target, platform, role, occurredMonth, rating, sentiment, category, comment } = validation.value;

  const admin = createAdminClient();
  const { data: voucher, error: voucherError } = await admin
    .from('profiles')
    .select('id, display_name, identity_check_status, fraud_banned_at, closed_at')
    .eq('id', user.id)
    .maybeSingle();
  if (voucherError || !voucher) return fail('persistence-error', SAVE_FAILED);
  if (voucher.fraud_banned_at || voucher.closed_at) {
    return fail('not-allowed', "This account can't post references.");
  }
  if (voucher.identity_check_status !== 'VERIFIED') {
    return fail(
      'identity-unverified',
      'Verify your ID first so every experience comes from a verified person.',
    );
  }

  // Who it is for. A claimed handle's references belong to its claimant.
  let targetProfileId: string | null = null;
  let targetClaimId: string | null = null;
  if (target.kind === 'profile') {
    targetProfileId = target.profileId;
  } else {
    const claim =
      target.kind === 'claim'
        ? (
            await admin
              .from('social_claims')
              .select('id, claimed_profile_id')
              .eq('id', target.claimId)
              .maybeSingle()
          ).data
        : await findOrCreateClaim(admin, target.platform, target.handle, user.id);
    if (!claim) {
      return target.kind === 'claim'
        ? fail('not-found', "We couldn't find that handle.")
        : fail('persistence-error', SAVE_FAILED);
    }
    if (claim.claimed_profile_id) targetProfileId = claim.claimed_profile_id;
    else targetClaimId = claim.id;
  }

  let targetPersonKey: string | null = null;
  const voucherPersonKey = await personKeyFor(admin, user.id);
  if (targetProfileId) {
    if (targetProfileId === user.id) {
      return fail('self-reference', "You can't give yourself a reference.");
    }
    const { data: profile } = await admin
      .from('profiles')
      .select('id, fraud_banned_at, closed_at')
      .eq('id', targetProfileId)
      .maybeSingle();
    if (!profile || profile.fraud_banned_at || profile.closed_at) {
      return fail('not-found', "We couldn't find that person.");
    }
    targetPersonKey = await personKeyFor(admin, targetProfileId);
    if (targetPersonKey === voucherPersonKey) {
      return fail('self-reference', "You can't give yourself a reference.");
    }
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const { count } = await admin
    .from('member_references')
    .select('id', { count: 'exact', head: true })
    .eq('voucher_id', user.id)
    .gte('created_at', dayStart.toISOString());
  if ((count ?? 0) >= REFERENCES_PER_DAY) {
    return fail('rate-limited', "You've posted a lot of references today. Try again tomorrow.");
  }

  const existingQuery = admin
    .from('member_references')
    .select('id, deal_count, occurred_month')
    .eq('status', 'LIVE');
  const { data: existing } = targetPersonKey
    ? await existingQuery
        .eq('voucher_person_key', voucherPersonKey)
        .eq('target_person_key', targetPersonKey)
        .eq('sentiment', sentiment)
        .maybeSingle()
    : await existingQuery
        .eq('voucher_id', user.id)
        .eq('target_claim_id', targetClaimId!)
        .eq('sentiment', sentiment)
        .maybeSingle();

  if (existing) {
    // A LATER MONTH IS ANOTHER DEAL; the same or an earlier month is this deal told
    // again, so publishing over and over can never raise the count.
    const addedDeal = occurredMonth > existing.occurred_month;
    const now = new Date().toISOString();
    const { error } = await admin
      .from('member_references')
      .update({
        deal_count: addedDeal ? existing.deal_count + 1 : existing.deal_count,
        platform,
        rating,
        category,
        comment,
        role,
        occurred_month: addedDeal ? occurredMonth : existing.occurred_month,
        // The same deal told again rewrites what readers already saw.
        ...(addedDeal ? {} : { edited_at: now }),
        updated_at: now,
      })
      .eq('id', existing.id);
    if (error) return fail('persistence-error', SAVE_FAILED);
    revalidateReferences(targetProfileId);
    return ok({ referenceId: existing.id, addedDeal });
  }

  const { data: inserted, error: insertError } = await admin
    .from('member_references')
    .insert({
      voucher_id: user.id,
      target_profile_id: targetProfileId,
      target_claim_id: targetClaimId,
      platform,
      sentiment,
      rating,
      category,
      comment,
      role,
      occurred_month: occurredMonth,
      voucher_person_key: voucherPersonKey,
      target_person_key: targetPersonKey,
    })
    .select('id')
    .single();
  if (insertError || !inserted) return fail('persistence-error', SAVE_FAILED);

  if (targetProfileId) {
    await createNotification({
      userId: targetProfileId,
      type: 'SYSTEM',
      title:
        sentiment === 'NEGATIVE'
          ? 'You received a negative experience'
          : 'You received a reference',
      body:
        sentiment === 'NEGATIVE'
          ? `${voucher.display_name} shared a negative experience about a deal on ${platformLabel(platform)}.`
          : `${voucher.display_name} referenced you: ${roleLabel(role).toLowerCase()} on ${platformLabel(platform)}.`,
      link: `/sellers/${targetProfileId}`,
    });
  }
  revalidateReferences(targetProfileId);
  return ok({ referenceId: inserted.id, addedDeal: false });
});

// ---------------------------------------------------------------------------
// Proof uploads + receipt-checked tier
// ---------------------------------------------------------------------------

async function mintUpload(
  bucket: string,
  contentType: string,
): Promise<ActionResult<{ path: string; token: string }, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in to add screenshots.');
  if (!(await referenceUploadLimiter.check(user.id)).allowed) return fail('rate-limited', RATE_LIMITED);
  try {
    return ok(await createSignedReferenceUpload(createAdminClient(), bucket, user.id, contentType));
  } catch (error) {
    return fail(
      'persistence-error',
      error instanceof Error ? error.message : 'Could not prepare the upload.',
    );
  }
}

export const createReferenceProofUpload = withActionLog('references.createReferenceProofUpload', async function createReferenceProofUpload(
  contentType: string,
): Promise<ActionResult<{ path: string; token: string }, ReferenceError>> {
  return mintUpload(REFERENCE_PROOF_BUCKET, contentType);
});

export const createHandleClaimUpload = withActionLog('references.createHandleClaimUpload', async function createHandleClaimUpload(
  contentType: string,
): Promise<ActionResult<{ path: string; token: string }, ReferenceError>> {
  return mintUpload(HANDLE_CLAIM_EVIDENCE_BUCKET, contentType);
});

export const attachReferenceProof = withActionLog('references.attachReferenceProof', async function attachReferenceProof(
  referenceId: string,
  paths: string[],
): Promise<ActionResult<{ attached: true }, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in first.');

  const admin = createAdminClient();
  let verifiedPaths: string[];
  try {
    verifiedPaths = await existingReferenceImages(admin, REFERENCE_PROOF_BUCKET, user.id, paths ?? []);
  } catch {
    return fail('persistence-error', SAVE_FAILED);
  }
  if (verifiedPaths.length === 0) {
    return fail('invalid-reference', 'Add at least one screenshot.', 'proof');
  }

  const { data, error } = await admin
    .from('member_references')
    .update({
      proof_paths: verifiedPaths.slice(0, 5),
      proof_status: 'PENDING',
      updated_at: new Date().toISOString(),
    })
    .eq('id', referenceId)
    .eq('voucher_id', user.id)
    .eq('status', 'LIVE')
    .select('target_profile_id')
    .maybeSingle();
  if (error) return fail('persistence-error', SAVE_FAILED);
  if (!data) return fail('not-found', "That reference isn't yours.");
  revalidateReferences(data.target_profile_id);
  return ok({ attached: true });
});

// ---------------------------------------------------------------------------
// Manual handle claims (staff decision)
// ---------------------------------------------------------------------------

const MANUAL_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * `handle_claim_requests.bio_code` is required, but only an Instagram DM claim has a code
 * anyone sends. A manual claim stores one no DM can carry: the webhook reads `ND-` only.
 */
function manualClaimCode(): string {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) suffix += MANUAL_CODE_ALPHABET[randomInt(MANUAL_CODE_ALPHABET.length)];
  return `noditto-${suffix}`;
}

// ---------------------------------------------------------------------------
// Instagram DM Bot handle claiming (works for personal & professional accounts)
// ---------------------------------------------------------------------------

const DM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * The one-time code a member DMs to the bot, unique to (handle, CLAIMANT).
 *
 * It used to depend on the handle alone, so everyone claiming @someone was shown the
 * same code. An attacker could start a claim for @someone, wait for the real owner to
 * DM that shared code, then press "I've sent the DM" first and be approved for a
 * handle they never controlled. Keyed by claimant, the owner's DM carries a code that
 * only the owner's own pending request holds. Stable per pair so a reopened dialog
 * shows the same code.
 */
function deterministicDmCode(handleNorm: string, claimantId: string): string {
  const secret =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'noditto-ig-dm-secret';
  const digest = createHmac('sha256', secret).update(`ig-dm:${handleNorm}:${claimantId}`).digest();
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += DM_CODE_ALPHABET[digest[i] % DM_CODE_ALPHABET.length];
  }
  return `ND-${suffix}`;
}

export interface InstagramDmClaimSession {
  /** Null until signed in: the code is per claimant, so a visitor has none yet. */
  code: string | null;
  botHandle: string;
  signedIn: boolean;
  status: 'PENDING' | 'APPROVED';
}

export const startInstagramDmClaim = withActionLog(
  'references.startInstagramDmClaim',
  async function startInstagramDmClaim(
    rawHandle: string,
  ): Promise<ActionResult<InstagramDmClaimSession, ReferenceError>> {
    const cleanHandle = normalizeClaimHandle('instagram', rawHandle);
    if (!cleanHandle) return fail('invalid-reference', 'Enter a valid Instagram handle.');

    const handleNorm = cleanHandle.toLowerCase();
    const botHandle = instagramBotHandle();
    // The bot cannot prove it owns itself by DM (see lib/instagram/botHandle.ts).
    if (isInstagramBotHandle(handleNorm)) {
      return fail('not-allowed', "That's NoDitto's own Instagram account, so it can't be claimed here.");
    }

    const user = await getCachedAuthUser();
    if (!user) {
      return ok({
        code: null,
        botHandle,
        signedIn: false,
        status: 'PENDING',
      });
    }
    if (!(await handleClaimLimiter.check(user.id)).allowed) return fail('rate-limited', RATE_LIMITED);
    const code = deterministicDmCode(handleNorm, user.id);

    const admin = createAdminClient();
    const refusal = await claimRefusal(admin, user.id);
    if (refusal) return refusal;

    const claim = await findOrCreateClaim(admin, 'instagram', cleanHandle, user.id);
    if (!claim) return fail('persistence-error', SAVE_FAILED);
    if (claim.claimed_profile_id === user.id) {
      return ok({ code, botHandle, signedIn: true, status: 'APPROVED' });
    }
    if (claim.claimed_profile_id) {
      return fail('not-allowed', 'This Instagram account has already been claimed.');
    }

    const { data: existingReq } = await admin
      .from('handle_claim_requests')
      .select('id, bio_code, status')
      .eq('claim_id', claim.id)
      .eq('claimant_id', user.id)
      .eq('status', 'PENDING')
      .maybeSingle();

    if (existingReq) {
      if (existingReq.bio_code !== code) {
        await admin
          .from('handle_claim_requests')
          .update({ bio_code: code, updated_at: new Date().toISOString() })
          .eq('id', existingReq.id);
      }
      return ok({ code, botHandle, signedIn: true, status: 'PENDING' });
    }

    await admin.from('handle_claim_requests').insert({
      claim_id: claim.id,
      claimant_id: user.id,
      bio_code: code,
    });

    return ok({ code, botHandle, signedIn: true, status: 'PENDING' });
  },
);

async function checkInstagramGraphDmForCode(
  handleNorm: string,
  expectedCode: string,
): Promise<boolean> {
  // The refreshed token (0160) while it descends from the env token, else the env token.
  const token = await getInstagramBotToken();
  // Each early exit is logged: a silent `false` here is indistinguishable from "the
  // member has not sent the DM yet", which is how a misconfigured bot went unnoticed.
  if (!token) {
    await logBackgroundFailure({
      name: 'references.instagram_dm.inbox',
      errorCode: 'NO_ACCESS_TOKEN',
      message: 'INSTAGRAM_PAGE_ACCESS_TOKEN (or INSTAGRAM_ACCESS_TOKEN) is not set',
    });
    return false;
  }

  const url = new URL('https://graph.instagram.com/v20.0/me/conversations');
  url.searchParams.set('platform', 'instagram');
  url.searchParams.set('fields', 'participants,messages.limit(10){message,from}');
  url.searchParams.set('access_token', token);

  // Bounded: the claim dialog runs this check in a loop, and Next runs a page's Server
  // Actions one at a time, so a hung Graph call would hold up every click behind it.
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res?.ok) {
    const body = res
      ? ((await res.json().catch(() => ({}))) as { error?: { message?: string } })
      : null;
    await logBackgroundFailure({
      name: 'references.instagram_dm.inbox',
      errorCode: res ? `GRAPH_${res.status}` : 'GRAPH_UNREACHABLE',
      message: body?.error?.message ?? 'Reading the bot inbox failed',
    });
    return false;
  }

  const json = (await res.json()) as {
    data?: Array<{
      participants?: { data?: Array<{ username?: string }> };
      messages?: {
        data?: Array<{
          message?: string;
          from?: { username?: string };
        }>;
      };
    }>;
  };

  const upperCode = expectedCode.toUpperCase();
  for (const convo of json.data ?? []) {
    for (const msg of convo.messages?.data ?? []) {
      // The SENDER must be the handle. This used to also accept any message in a
      // conversation that merely included the handle as a participant, which let a
      // code typed by someone else (or by the bot itself) count as proof.
      const fromUser = (msg.from?.username ?? '').trim().replace(/^@/, '').toLowerCase();
      // The bot's own messages are never proof of anything.
      if (isInstagramBotHandle(fromUser)) continue;
      if (fromUser === handleNorm && (msg.message ?? '').toUpperCase().includes(upperCode)) {
        return true;
      }
    }
  }
  return false;
}

export const checkInstagramDmClaim = withActionLog(
  'references.checkInstagramDmClaim',
  async function checkInstagramDmClaim(
    rawHandle: string,
  ): Promise<ActionResult<{ verified: boolean }, ReferenceError>> {
    const user = await getCachedAuthUser();
    if (!user) return fail('not-authenticated', 'Sign in to verify your Instagram DM.');

    const cleanHandle = normalizeClaimHandle('instagram', rawHandle);
    if (!cleanHandle) return fail('invalid-reference', 'Enter a valid Instagram handle.');

    const handleNorm = cleanHandle.toLowerCase();
    // Never approve the bot's own handle (see lib/instagram/botHandle.ts).
    if (isInstagramBotHandle(handleNorm)) {
      return fail('not-allowed', "That's NoDitto's own Instagram account, so it can't be claimed here.");
    }
    if (!(await handleClaimLimiter.check(user.id)).allowed) return fail('rate-limited', RATE_LIMITED);
    const admin = createAdminClient();
    const refusal = await claimRefusal(admin, user.id);
    if (refusal) return refusal;

    const { data: claim } = await admin
      .from('social_claims')
      .select('id, claimed_profile_id')
      .eq('platform', 'instagram')
      .eq('handle_norm', handleNorm)
      .maybeSingle();

    if (!claim) return ok({ verified: false });
    if (claim.claimed_profile_id === user.id) {
      revalidateReferences(user.id);
      return ok({ verified: true });
    }
    if (claim.claimed_profile_id) {
      return fail('not-allowed', 'This Instagram account has already been claimed.');
    }

    // This member's own code: someone else's DM to the bot, even for the same handle,
    // carries a different one and cannot approve this request.
    const code = deterministicDmCode(handleNorm, user.id);
    const matchedInDm = await checkInstagramGraphDmForCode(handleNorm, code);
    if (!matchedInDm) {
      return ok({ verified: false });
    }

    // THE CLAIM FIRST, AND ONLY ON ITS SUCCESS THE REQUEST. The claim is what links the
    // handle, and it can refuse: someone else claimed it in between, or moving its
    // references failed. A request marked approved over a claim that never happened
    // tells the member the handle is linked when it is not.
    const now = new Date().toISOString();
    const { data: claimed, error: claimError } = await admin
      .from('social_claims')
      .update({
        claimed_profile_id: user.id,
        claim_method: 'DM_BOT',
        claimed_at: now,
        updated_at: now,
      })
      .eq('id', claim.id)
      .is('claimed_profile_id', null)
      .select('id')
      .maybeSingle();
    if (claimError) {
      await logBackgroundFailure({
        name: 'references.instagram_dm.approve',
        errorCode: claimError.code || 'CLAIM_FAILED',
        message: claimError.message,
        context: { claimId: claim.id },
      });
      return fail('persistence-error', SAVE_FAILED);
    }
    if (!claimed) return fail('not-allowed', 'This Instagram account has already been claimed.');

    const { error: requestError } = await admin
      .from('handle_claim_requests')
      .update({
        status: 'APPROVED',
        staff_notes: `Verified automatically via Instagram DM bot (@${handleNorm})`,
        decided_at: now,
        updated_at: now,
      })
      .eq('claim_id', claim.id)
      .eq('claimant_id', user.id)
      .eq('status', 'PENDING');
    if (requestError) {
      await logBackgroundFailure({
        name: 'references.instagram_dm.approve',
        errorCode: requestError.code || 'REQUEST_UPDATE_FAILED',
        message: requestError.message,
        context: { claimId: claim.id },
      });
    }

    revalidateReferences(user.id);
    return ok({ verified: true });
  },
);

export const submitManualHandleClaim = withActionLog(
  'references.submitManualHandleClaim',
  async function submitManualHandleClaim(input: {
    /** The platform the handle is on: staff check the screenshot against it. */
    platform: string;
    handle: string;
    message?: string;
    paths: string[];
  }): Promise<ActionResult<{ requestId: string }, ReferenceError>> {
    const user = await getCachedAuthUser();
    if (!user) return fail('not-authenticated', 'Sign in first.');
    if (!(await handleClaimLimiter.check(user.id)).allowed) return fail('rate-limited', RATE_LIMITED);

    const platform = input.platform;
    if (!isClaimPlatform(platform)) {
      return fail('invalid-reference', 'Choose the platform this handle is on.', 'platform');
    }
    const cleanHandle = normalizeClaimHandle(platform, input.handle);
    if (!cleanHandle) return fail('invalid-reference', 'Enter a valid handle.', 'handle');

    const admin = createAdminClient();

    // A MANUAL CLAIM NEEDS A VERIFIED ID. Staff link the handle on the strength of a
    // screenshot, which can be faked, so the person asking has to be a checked,
    // accountable one. The Instagram DM claim deliberately does not ask: the DM is sent
    // from the account itself, which is the proof. `decideHandleClaim` re-checks at
    // approval.
    const { data: claimant, error: claimantError } = await admin
      .from('profiles')
      .select('identity_check_status, fraud_banned_at, closed_at')
      .eq('id', user.id)
      .maybeSingle();
    if (claimantError) return fail('persistence-error', SAVE_FAILED);
    if (!claimant || claimant.fraud_banned_at || claimant.closed_at) {
      return fail('not-allowed', "This account can't claim handles.");
    }
    if (
      !satisfiesIdentityGate({
        identityCheckStatus: (claimant.identity_check_status ?? 'NONE') as IdentityCheckStatus,
      })
    ) {
      return fail(
        'identity-unverified',
        'Verify your ID first so your claimed handle carries your verified name.',
      );
    }

    let verifiedPaths: string[];
    try {
      verifiedPaths = await existingReferenceImages(
        admin,
        HANDLE_CLAIM_EVIDENCE_BUCKET,
        user.id,
        input.paths ?? [],
      );
    } catch {
      return fail('persistence-error', SAVE_FAILED);
    }
    if (verifiedPaths.length === 0) {
      return fail('invalid-reference', 'Attach at least one screenshot or image as proof.');
    }

    const claim = await findOrCreateClaim(admin, platform, cleanHandle, user.id);
    if (!claim) return fail('persistence-error', SAVE_FAILED);
    if (claim.claimed_profile_id) {
      return fail(
        'not-allowed',
        claim.claimed_profile_id === user.id
          ? 'You already claimed this handle.'
          : 'This handle is already claimed.',
      );
    }

    const note = (input.message ?? '').trim().slice(0, 1000) || null;
    const { data: existingReq } = await admin
      .from('handle_claim_requests')
      .select('id')
      .eq('claim_id', claim.id)
      .eq('claimant_id', user.id)
      .eq('status', 'PENDING')
      .maybeSingle();

    const { data, error } = existingReq
      ? await admin
          .from('handle_claim_requests')
          .update({
            screenshot_paths: verifiedPaths.slice(0, 5),
            staff_notes: note,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingReq.id)
          .select('id')
          .single()
      : await admin
          .from('handle_claim_requests')
          .insert({
            claim_id: claim.id,
            claimant_id: user.id,
            bio_code: manualClaimCode(),
            screenshot_paths: verifiedPaths.slice(0, 5),
            staff_notes: note,
          })
          .select('id')
          .single();

    if (error || !data) return fail('persistence-error', SAVE_FAILED);

    revalidateReferences(user.id);
    return ok({ requestId: data.id });
  },
);

// ---------------------------------------------------------------------------
// edit / withdraw / dispute
// ---------------------------------------------------------------------------

/**
 * Change a reference you left: the deal, when it was, the rating and your words. Who it
 * is for never changes; withdraw it and leave a new one for that. Readers see that it
 * was edited.
 */
export const updateReference = withActionLog('references.updateReference', async function updateReference(
  referenceId: string,
  input: ReferenceDetailsInput,
): Promise<ActionResult<{ referenceId: string }, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in first.');
  if (!(await referenceWriteLimiter.check(user.id)).allowed) return fail('rate-limited', RATE_LIMITED);
  if (!isUuid(referenceId)) return fail('not-found', "That reference isn't yours to edit.");

  const validation = validateReferenceDetails(input);
  if (!validation.ok) return fail('invalid-reference', validation.message, validation.field);
  const { platform, role, occurredMonth, rating, sentiment, category, comment } = validation.value;

  const admin = createAdminClient();
  const { data: author, error: authorError } = await admin
    .from('profiles')
    .select('fraud_banned_at, closed_at')
    .eq('id', user.id)
    .maybeSingle();
  if (authorError) return fail('persistence-error', SAVE_FAILED);
  if (!author || author.fraud_banned_at || author.closed_at) {
    return fail('not-allowed', "This account can't change references.");
  }

  const { data: reference, error: loadError } = await admin
    .from('member_references')
    .select('id, sentiment, voucher_person_key, target_person_key, target_profile_id, target_claim_id')
    .eq('id', referenceId)
    .eq('voucher_id', user.id)
    .eq('status', 'LIVE')
    .maybeSingle();
  if (loadError) return fail('persistence-error', SAVE_FAILED);
  if (!reference) return fail('not-found', "That reference isn't yours to edit.");

  // One live reference per pair of people per sentiment: a new rating that lands on the
  // sentiment of another reference already left for them would make two.
  const clashMessage = `You already left them a ${sentimentLabel(sentiment).toLowerCase()} reference. Edit or withdraw that one instead.`;
  if (sentiment !== reference.sentiment) {
    const others = admin
      .from('member_references')
      .select('id')
      .eq('status', 'LIVE')
      .eq('sentiment', sentiment)
      .neq('id', reference.id);
    const { data: clash } = reference.target_person_key
      ? await others
          .eq('voucher_person_key', reference.voucher_person_key)
          .eq('target_person_key', reference.target_person_key)
          .limit(1)
          .maybeSingle()
      : await others
          .eq('voucher_id', user.id)
          .eq('target_claim_id', reference.target_claim_id!)
          .limit(1)
          .maybeSingle();
    if (clash) return fail('invalid-reference', clashMessage, 'rating');
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from('member_references')
    .update({
      platform,
      role,
      occurred_month: occurredMonth,
      rating,
      sentiment,
      category,
      comment,
      edited_at: now,
      updated_at: now,
    })
    .eq('id', reference.id)
    .eq('voucher_id', user.id)
    .eq('status', 'LIVE');
  if (error) {
    // 23505: the same clash, by a request racing this one.
    return error.code === '23505'
      ? fail('invalid-reference', clashMessage, 'rating')
      : fail('persistence-error', SAVE_FAILED);
  }
  revalidateReferences(reference.target_profile_id);
  return ok({ referenceId: reference.id });
});

export const withdrawReference = withActionLog('references.withdrawReference', async function withdrawReference(
  referenceId: string,
): Promise<ActionResult<{ withdrawn: true }, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in first.');
  if (!(await referenceWriteLimiter.check(user.id)).allowed) return fail('rate-limited', RATE_LIMITED);
  if (!isUuid(referenceId)) return fail('not-found', "That reference isn't yours to withdraw.");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('member_references')
    .update({ status: 'WITHDRAWN', updated_at: new Date().toISOString() })
    .eq('id', referenceId)
    .eq('voucher_id', user.id)
    .eq('status', 'LIVE')
    .select('target_profile_id')
    .maybeSingle();
  if (error) return fail('persistence-error', SAVE_FAILED);
  if (!data) return fail('not-found', "That reference isn't yours to withdraw.");
  revalidateReferences(data.target_profile_id);
  return ok({ withdrawn: true });
});

export const disputeReference = withActionLog('references.disputeReference', async function disputeReference(
  referenceId: string,
): Promise<ActionResult<{ disputed: true }, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in first.');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('member_references')
    .update({
      disputed_at: new Date().toISOString(),
      disputed_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', referenceId)
    .eq('target_profile_id', user.id)
    .eq('status', 'LIVE')
    .select('id')
    .maybeSingle();
  if (error) return fail('persistence-error', SAVE_FAILED);
  if (!data) return fail('not-found', "That reference isn't about you.");
  return ok({ disputed: true });
});
