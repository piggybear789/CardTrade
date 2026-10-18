'use server';

// lib/actions/references.ts
//
// References (0155): unified cross-platform search, add-a-person, and
// sharing / withdrawing / disputing an experience. Everything writes through
// the service role, because `social_claims` and `member_references` carry no
// member grant; each action checks who is asking before it touches a row.
//
// Both positive and negative experiences go LIVE immediately and are linked
// to the author's verified identity.

import { randomInt } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { withActionLog } from '@/lib/errors/withActionLog';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { createNotification } from '@/lib/notifications/createNotification';
import {
  createSignedReferenceUpload,
  existingReferenceImages,
} from '@/lib/storage/referenceImages';
import {
  HANDLE_CLAIM_EVIDENCE_BUCKET,
  REFERENCE_PROOF_BUCKET,
} from '@/lib/storage/referenceImagesShared';
import {
  REFERENCES_PER_DAY,
  claimPlatformForDealPlatform,
  normalizeClaimHandle,
  platformLabel,
  roleLabel,
  validateGiveReference,
  type GiveReferenceInput,
} from '@/domain/references/reference';
import { type ActionResult, fail, ok } from './result';

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

/** One unified autofill suggestion on /references, synthesised across platforms. */
export interface ReferenceSuggestion {
  kind: 'profile' | 'claim';
  /** profiles.id when claimed, social_claims.id when not. */
  id: string;
  /** The profile id when claimed. Null while unclaimed. */
  profileId: string | null;
  platform: string;
  platformLabel: string;
  /** Every platform associated with this person or handle. */
  platforms: string[];
  /** With a leading @. */
  handle: string;
  /** Without @, for `/references/[handle]`. */
  handleSlug: string;
  /** NoDitto display name, or the claim's handle when unclaimed. */
  name: string;
  /** Provider-verified given name. Null when not disclosed / unclaimed. */
  firstName: string | null;
  identityVerified: boolean;
  regionCode: string | null;
  avatarPath: string | null;
  referenceCount: number;
  unclaimed: boolean;
}

/** The target a ShareExperience form posts against. */
export interface ReferenceTargetDescriptor {
  kind: 'profile' | 'claim' | 'handle';
  id: string;
  profileId: string | null;
  handle: string;
  handleSlug?: string;
  name: string;
  platform: string;
  firstName: string | null;
  identityVerified: boolean;
  unclaimed: boolean;
}

type Admin = ReturnType<typeof createAdminClient>;

async function personKeyFor(admin: Admin, profileId: string): Promise<string> {
  const { data } = await admin
    .from('identity_person_keys')
    .select('fingerprint, kind')
    .eq('profile_id', profileId);
  const rows = data ?? [];
  const doc = rows.find((row) => row.kind === 'document-id');
  return (doc ?? rows[0])?.fingerprint ?? `profile:${profileId}`;
}

function firstGivenName(full: string | null | undefined): string | null {
  const first = full?.trim().split(/\s+/)[0];
  return first ? first : null;
}

// ---------------------------------------------------------------------------
// searchReferences
// ---------------------------------------------------------------------------

/**
 * Unified cross-platform autofill for `/references`: deduplicates by person /
 * handle so each trader appears once with all platforms they have dealt on.
 */
export const searchReferences = withActionLog('references.searchReferences', async function searchReferences(
  query: string,
): Promise<ActionResult<ReferenceSuggestion[], 'persistence-error'>> {
  const needle = (query ?? '').trim().replace(/^@/, '').toLowerCase();
  const admin = createAdminClient();

  const claimsQuery = admin
    .from('social_claims')
    .select('id, platform, handle, handle_norm, claimed_profile_id')
    .order('handle', { ascending: true })
    .limit(60);
  const profilesQuery = admin
    .from('profiles')
    .select(
      'id, display_name, identity_check_status, identity_check_name, region_code, avatar_path, fraud_banned_at, closed_at',
    )
    .is('fraud_banned_at', null)
    .is('closed_at', null)
    .limit(40);

  const [{ data: claims, error: claimsError }, { data: namedProfiles, error: profilesError }] =
    await Promise.all([
      needle ? claimsQuery.ilike('handle', `%${needle}%`) : claimsQuery,
      needle
        ? profilesQuery.ilike('display_name', `%${needle}%`)
        : profilesQuery.order('created_at', { ascending: false }),
    ]);
  if (claimsError || profilesError) return fail('persistence-error', SAVE_FAILED);

  const claimRows = claims ?? [];
  const claimedIds = claimRows
    .map((row) => row.claimed_profile_id)
    .filter((id): id is string => Boolean(id));
  const namedIds = (namedProfiles ?? []).map((row) => row.id);
  const profileIds = Array.from(new Set([...claimedIds, ...namedIds]));

  const [{ data: profiles }, { data: allProfileClaims }, { data: edges }, { data: reviews }] =
    await Promise.all([
      profileIds.length
        ? admin
            .from('profiles')
            .select(
              'id, display_name, identity_check_status, identity_check_name, region_code, avatar_path, fraud_banned_at, closed_at',
            )
            .in('id', profileIds)
            .is('fraud_banned_at', null)
            .is('closed_at', null)
        : Promise.resolve({ data: [] }),
      profileIds.length
        ? admin
            .from('social_claims')
            .select('id, platform, handle, claimed_profile_id')
            .in('claimed_profile_id', profileIds)
        : Promise.resolve({ data: [] }),
      admin
        .from('reference_edges_public')
        .select('target_profile_id, target_claim_id, platform, sentiment, deal_count')
        .limit(5000),
      profileIds.length
        ? admin.from('reviews').select('reviewee_id').in('reviewee_id', profileIds).limit(2000)
        : Promise.resolve({ data: [] as { reviewee_id: string }[] }),
    ]);

  const profileById = new Map((profiles ?? []).map((row) => [row.id, row]));
  const claimsByProfile = new Map<string, { id: string; platform: string; handle: string }[]>();
  for (const row of allProfileClaims ?? []) {
    if (!row.claimed_profile_id) continue;
    const list = claimsByProfile.get(row.claimed_profile_id) ?? [];
    list.push({ id: row.id, platform: row.platform, handle: row.handle });
    claimsByProfile.set(row.claimed_profile_id, list);
  }

  const countByProfile = new Map<string, number>();
  const countByClaim = new Map<string, number>();
  const platformsByProfile = new Map<string, Set<string>>();
  const platformsByClaim = new Map<string, Set<string>>();

  for (const edge of edges ?? []) {
    if (edge.target_profile_id) {
      if (edge.sentiment === 'POSITIVE') {
        countByProfile.set(
          edge.target_profile_id,
          (countByProfile.get(edge.target_profile_id) ?? 0) + edge.deal_count,
        );
      }
      const set = platformsByProfile.get(edge.target_profile_id) ?? new Set<string>();
      set.add(edge.platform);
      platformsByProfile.set(edge.target_profile_id, set);
    }
    if (edge.target_claim_id) {
      if (edge.sentiment === 'POSITIVE') {
        countByClaim.set(
          edge.target_claim_id,
          (countByClaim.get(edge.target_claim_id) ?? 0) + edge.deal_count,
        );
      }
      const set = platformsByClaim.get(edge.target_claim_id) ?? new Set<string>();
      set.add(edge.platform);
      platformsByClaim.set(edge.target_claim_id, set);
    }
  }
  for (const rev of reviews ?? []) {
    countByProfile.set(rev.reviewee_id, (countByProfile.get(rev.reviewee_id) ?? 0) + 1);
    const set = platformsByProfile.get(rev.reviewee_id) ?? new Set<string>();
    set.add('noditto');
    platformsByProfile.set(rev.reviewee_id, set);
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

  const byKey = new Map<string, ReferenceSuggestion & { score: number }>();

  for (const claim of claimRows) {
    const profile = claim.claimed_profile_id ? profileById.get(claim.claimed_profile_id) : null;
    if (claim.claimed_profile_id && !profile) continue;

    if (profile) {
      const key = `profile:${profile.id}`;
      if (byKey.has(key)) continue;
      const linked = claimsByProfile.get(profile.id) ?? [claim];
      const platSet = new Set<string>(linked.map((c) => c.platform));
      for (const p of platformsByProfile.get(profile.id) ?? []) platSet.add(p);
      const platforms = Array.from(platSet);
      const handleSlug = claim.handle;
      const handle = `@${handleSlug}`;
      byKey.set(key, {
        kind: 'profile',
        id: profile.id,
        profileId: profile.id,
        platform: claim.platform,
        platformLabel: platforms.map(platformLabel).join(' · ') || platformLabel(claim.platform),
        platforms,
        handle,
        handleSlug,
        name: profile.display_name,
        firstName:
          profile.identity_check_status === 'VERIFIED'
            ? firstGivenName(profile.identity_check_name)
            : null,
        identityVerified: profile.identity_check_status === 'VERIFIED',
        regionCode: profile.region_code ?? null,
        avatarPath: profile.avatar_path ?? null,
        referenceCount: countByProfile.get(profile.id) ?? 0,
        unclaimed: false,
        score: score(handle, profile.display_name),
      });
    } else {
      const key = `handle:${claim.handle_norm}`;
      const existing = byKey.get(key);
      const claimPlats = platformsByClaim.get(claim.id) ?? new Set<string>([claim.platform]);
      if (existing) {
        for (const p of claimPlats) {
          if (!existing.platforms.includes(p)) existing.platforms.push(p);
        }
        existing.platformLabel = existing.platforms.map(platformLabel).join(' · ');
        existing.referenceCount += countByClaim.get(claim.id) ?? 0;
        continue;
      }
      const platforms = Array.from(claimPlats);
      const handle = `@${claim.handle}`;
      byKey.set(key, {
        kind: 'claim',
        id: claim.id,
        profileId: null,
        platform: claim.platform,
        platformLabel: platforms.map(platformLabel).join(' · '),
        platforms,
        handle,
        handleSlug: claim.handle,
        name: claim.handle,
        firstName: null,
        identityVerified: false,
        regionCode: null,
        avatarPath: null,
        referenceCount: countByClaim.get(claim.id) ?? 0,
        unclaimed: true,
        score: score(handle, claim.handle),
      });
    }
  }

  for (const profile of namedProfiles ?? []) {
    const key = `profile:${profile.id}`;
    if (byKey.has(key) || !profileById.has(profile.id)) continue;
    const linked = claimsByProfile.get(profile.id) ?? [];
    const platSet = new Set<string>(linked.map((c) => c.platform));
    for (const p of platformsByProfile.get(profile.id) ?? []) platSet.add(p);
    if (platSet.size === 0) platSet.add('noditto');
    const platforms = Array.from(platSet);
    const handleSlug = linked[0]?.handle ?? profile.display_name;
    const handle = `@${handleSlug}`;
    byKey.set(key, {
      kind: 'profile',
      id: profile.id,
      profileId: profile.id,
      platform: platforms[0] ?? 'noditto',
      platformLabel: platforms.map(platformLabel).join(' · '),
      platforms,
      handle,
      handleSlug,
      name: profile.display_name,
      firstName:
        profile.identity_check_status === 'VERIFIED'
          ? firstGivenName(profile.identity_check_name)
          : null,
      identityVerified: profile.identity_check_status === 'VERIFIED',
      regionCode: profile.region_code,
      avatarPath: profile.avatar_path,
      referenceCount: countByProfile.get(profile.id) ?? 0,
      unclaimed: false,
      score: score(handle, profile.display_name),
    });
  }

  return ok(
    Array.from(byKey.values())
      .sort(
        (a, b) =>
          a.score - b.score ||
          b.referenceCount - a.referenceCount ||
          a.handle.localeCompare(b.handle),
      )
      .slice(0, 8)
      .map(({ score: _score, ...rest }) => rest),
  );
});

// ---------------------------------------------------------------------------
// addUnclaimedHandle
// ---------------------------------------------------------------------------

/**
 * Add or resolve a handle across platforms. Idempotent: if the handle already
 * exists on the chosen platform (or any platform), returns it so the user
 * lands directly on `/references/[handle]`.
 */
export const addUnclaimedHandle = withActionLog('references.addUnclaimedHandle', async function addUnclaimedHandle(input: {
  platform?: string;
  handle: string;
}): Promise<ActionResult<ReferenceSuggestion, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in to add someone.');

  const claimPlatform = claimPlatformForDealPlatform(input?.platform ?? 'instagram');
  const handle = normalizeClaimHandle(claimPlatform, input?.handle ?? '');
  if (!handle) {
    return fail(
      'invalid-reference',
      "That handle doesn't look right. Use the username only, no @ or link.",
      'handle',
    );
  }

  const admin = createAdminClient();
  const { data: inserted, error: insertError } = await admin
    .from('social_claims')
    .insert({ platform: claimPlatform, handle, created_by: user.id })
    .select('id, platform, handle, claimed_profile_id')
    .maybeSingle();
  if (insertError && insertError.code !== '23505') return fail('persistence-error', SAVE_FAILED);

  const row =
    inserted ??
    (
      await admin
        .from('social_claims')
        .select('id, platform, handle, claimed_profile_id')
        .eq('platform', claimPlatform)
        .eq('handle_norm', handle.toLowerCase())
        .maybeSingle()
    ).data;
  if (!row) return fail('persistence-error', SAVE_FAILED);

  return ok({
    kind: row.claimed_profile_id ? 'profile' : 'claim',
    id: row.claimed_profile_id ?? row.id,
    profileId: row.claimed_profile_id,
    platform: row.platform,
    platformLabel: platformLabel(row.platform),
    platforms: [row.platform],
    handle: `@${row.handle}`,
    handleSlug: row.handle,
    name: row.handle,
    firstName: null,
    identityVerified: false,
    regionCode: null,
    avatarPath: null,
    referenceCount: 0,
    unclaimed: !row.claimed_profile_id,
  });
});

// ---------------------------------------------------------------------------
// giveReference
// ---------------------------------------------------------------------------

/**
 * Share an experience (positive or negative) from an ID-verified member.
 * Goes LIVE immediately. Repeat experiences for the same pair and sentiment
 * update the deal count and written note without inflating the unique-people
 * count.
 */
export const giveReference = withActionLog('references.giveReference', async function giveReference(
  input: GiveReferenceInput,
): Promise<ActionResult<{ referenceId: string; addedDeal: boolean }, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in to share your experience.');

  const validation = validateGiveReference(input);
  if (!validation.ok) return fail('invalid-reference', validation.message, validation.field);
  const { target, platform, role, occurredMonth, sentiment, category, comment } = validation.value;

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

  let targetProfileId: string | null = null;
  let targetClaimId: string | null = null;
  let targetPersonKey: string | null = null;
  let targetHandleSlug: string | null = null;

  if (target.kind === 'profile') {
    const { data: profile } = await admin
      .from('profiles')
      .select('id, display_name, fraud_banned_at, closed_at')
      .eq('id', target.profileId)
      .maybeSingle();
    if (!profile || profile.fraud_banned_at || profile.closed_at) {
      return fail('not-found', "We couldn't find that person.");
    }
    targetProfileId = profile.id;
    targetHandleSlug = profile.display_name;
  } else if (target.kind === 'claim') {
    const { data: claim } = await admin
      .from('social_claims')
      .select('id, handle, claimed_profile_id')
      .eq('id', target.claimId)
      .maybeSingle();
    if (!claim) return fail('not-found', "We couldn't find that handle.");
    targetHandleSlug = claim.handle;
    if (claim.claimed_profile_id) {
      targetProfileId = claim.claimed_profile_id;
    } else {
      targetClaimId = claim.id;
    }
  } else {
    // target.kind === 'handle': resolve existing claim/profile or create an unclaimed social_claims row
    const handleNorm = target.handle.toLowerCase();
    targetHandleSlug = target.handle;
    const { data: existingClaims } = await admin
      .from('social_claims')
      .select('id, handle, claimed_profile_id')
      .eq('handle_norm', handleNorm);

    const claimed = (existingClaims ?? []).find((c) => c.claimed_profile_id);
    if (claimed?.claimed_profile_id) {
      targetProfileId = claimed.claimed_profile_id;
    } else if (existingClaims && existingClaims.length > 0) {
      targetClaimId = existingClaims[0].id;
    } else {
      const claimPlatform = claimPlatformForDealPlatform(platform);
      const { data: createdClaim, error: claimErr } = await admin
        .from('social_claims')
        .insert({ platform: claimPlatform, handle: target.handle, created_by: user.id })
        .select('id, claimed_profile_id')
        .maybeSingle();
      if (claimErr && claimErr.code !== '23505') {
        return fail('persistence-error', SAVE_FAILED);
      }
      if (createdClaim) {
        if (createdClaim.claimed_profile_id) targetProfileId = createdClaim.claimed_profile_id;
        else targetClaimId = createdClaim.id;
      } else {
        const { data: fallbackClaim } = await admin
          .from('social_claims')
          .select('id, claimed_profile_id')
          .eq('handle_norm', handleNorm)
          .limit(1)
          .maybeSingle();
        if (!fallbackClaim) return fail('persistence-error', SAVE_FAILED);
        if (fallbackClaim.claimed_profile_id) targetProfileId = fallbackClaim.claimed_profile_id;
        else targetClaimId = fallbackClaim.id;
      }
    }
  }

  const voucherPersonKey = await personKeyFor(admin, user.id);
  if (targetProfileId) {
    if (targetProfileId === user.id) {
      return fail('self-reference', "You can't give yourself a reference.");
    }
    targetPersonKey = await personKeyFor(admin, targetProfileId);
    if (targetPersonKey === voucherPersonKey && !targetPersonKey.startsWith('profile:')) {
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
    .select('id, deal_count')
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
    const { error } = await admin
      .from('member_references')
      .update({
        deal_count: existing.deal_count + 1,
        platform,
        category,
        comment,
        role,
        occurred_month: occurredMonth,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) return fail('persistence-error', SAVE_FAILED);
    if (targetProfileId) revalidatePath(`/sellers/${targetProfileId}`);
    if (targetHandleSlug) revalidatePath(`/references/${encodeURIComponent(targetHandleSlug)}`);
    revalidatePath('/references');
    return ok({ referenceId: existing.id, addedDeal: true });
  }

  const { data: inserted, error: insertError } = await admin
    .from('member_references')
    .insert({
      voucher_id: user.id,
      target_profile_id: targetProfileId,
      target_claim_id: targetClaimId,
      platform,
      sentiment,
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
    revalidatePath(`/sellers/${targetProfileId}`);
  }
  if (targetHandleSlug) revalidatePath(`/references/${encodeURIComponent(targetHandleSlug)}`);
  revalidatePath('/references');
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
    .eq('sentiment', 'POSITIVE')
    .select('target_profile_id')
    .maybeSingle();
  if (error) return fail('persistence-error', SAVE_FAILED);
  if (!data) return fail('not-found', "That reference isn't yours.");
  if (data.target_profile_id) revalidatePath(`/sellers/${data.target_profile_id}`);
  return ok({ attached: true });
});

// ---------------------------------------------------------------------------
// Handle claims (bio code + staff decision)
// ---------------------------------------------------------------------------

const BIO_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function newBioCode(): string {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) suffix += BIO_CODE_ALPHABET[randomInt(BIO_CODE_ALPHABET.length)];
  return `noditto-${suffix}`;
}

export interface MyHandleClaim {
  requestId: string;
  bioCode: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  screenshotCount: number;
}

export const getMyHandleClaim = withActionLog('references.getMyHandleClaim', async function getMyHandleClaim(
  claimId: string,
): Promise<MyHandleClaim | null> {
  const user = await getCachedAuthUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from('handle_claim_requests')
    .select('id, bio_code, status, screenshot_paths')
    .eq('claim_id', claimId)
    .eq('claimant_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    requestId: data.id,
    bioCode: data.bio_code,
    status: data.status,
    screenshotCount: data.screenshot_paths?.length ?? 0,
  };
});

export const startHandleClaim = withActionLog('references.startHandleClaim', async function startHandleClaim(
  claimId: string,
): Promise<ActionResult<MyHandleClaim, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in to claim this handle.');

  const admin = createAdminClient();
  const [{ data: profile }, { data: claim }] = await Promise.all([
    admin
      .from('profiles')
      .select('identity_check_status, fraud_banned_at, closed_at')
      .eq('id', user.id)
      .maybeSingle(),
    admin.from('social_claims').select('id, claimed_profile_id').eq('id', claimId).maybeSingle(),
  ]);
  if (!profile || profile.fraud_banned_at || profile.closed_at) {
    return fail('not-allowed', "This account can't claim handles.");
  }
  if (profile.identity_check_status !== 'VERIFIED') {
    return fail('identity-unverified', 'Verify your ID first so your claimed handle carries your verified name.');
  }
  if (!claim) return fail('not-found', "We couldn't find that handle.");
  if (claim.claimed_profile_id) {
    return fail(
      'not-allowed',
      claim.claimed_profile_id === user.id
        ? 'You already claimed this handle.'
        : 'This handle is already claimed.',
    );
  }

  const existing = await getMyHandleClaim(claimId);
  if (existing && existing.status === 'PENDING') return ok(existing);
  if (existing && existing.status === 'APPROVED') {
    return fail('not-allowed', 'You already claimed this handle.');
  }

  const { data, error } = await admin
    .from('handle_claim_requests')
    .insert({ claim_id: claimId, claimant_id: user.id, bio_code: newBioCode() })
    .select('id, bio_code, status, screenshot_paths')
    .single();
  if (error || !data) return fail('persistence-error', SAVE_FAILED);
  return ok({
    requestId: data.id,
    bioCode: data.bio_code,
    status: data.status,
    screenshotCount: data.screenshot_paths?.length ?? 0,
  });
});

export const submitHandleClaim = withActionLog('references.submitHandleClaim', async function submitHandleClaim(
  claimId: string,
  paths: string[],
): Promise<ActionResult<MyHandleClaim, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in first.');

  const admin = createAdminClient();
  let verifiedPaths: string[];
  try {
    verifiedPaths = await existingReferenceImages(admin, HANDLE_CLAIM_EVIDENCE_BUCKET, user.id, paths ?? []);
  } catch {
    return fail('persistence-error', SAVE_FAILED);
  }
  if (verifiedPaths.length === 0) {
    return fail('invalid-reference', 'Add a screenshot of the bio with your code in it.', 'proof');
  }

  const { data, error } = await admin
    .from('handle_claim_requests')
    .update({ screenshot_paths: verifiedPaths.slice(0, 5), updated_at: new Date().toISOString() })
    .eq('claim_id', claimId)
    .eq('claimant_id', user.id)
    .eq('status', 'PENDING')
    .select('id, bio_code, status, screenshot_paths')
    .maybeSingle();
  if (error) return fail('persistence-error', SAVE_FAILED);
  if (!data) return fail('not-found', 'Start the claim first so we can give you a code.');
  return ok({
    requestId: data.id,
    bioCode: data.bio_code,
    status: data.status,
    screenshotCount: data.screenshot_paths?.length ?? 0,
  });
});

// ---------------------------------------------------------------------------
// withdraw / dispute
// ---------------------------------------------------------------------------

export const withdrawReference = withActionLog('references.withdrawReference', async function withdrawReference(
  referenceId: string,
): Promise<ActionResult<{ withdrawn: true }, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in first.');

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
  if (data.target_profile_id) revalidatePath(`/sellers/${data.target_profile_id}`);
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
