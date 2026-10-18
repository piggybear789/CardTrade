'use server';

// lib/actions/references.ts
//
// References (0155): search, add-a-person, and giving / withdrawing /
// disputing a reference. Everything writes through the service role, because
// `social_claims` and `member_references` carry no member grant; each action
// checks who is asking before it touches a row (the same shape as
// `lib/actions/scamReports.ts`).
//
// A reference goes LIVE immediately: it is a positive, structured attestation
// from an ID-verified person. Bad experiences are NOT references — they are
// scam reports (0154), which stay private until staff act.

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
import { platformLabel, roleLabel } from '@/domain/references/reference';
import {
  REFERENCES_PER_DAY,
  normalizeClaimHandle,
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

/** One autofill suggestion on /references. */
export interface ReferenceSuggestion {
  kind: 'profile' | 'claim';
  /** profiles.id when claimed, social_claims.id when not. */
  id: string;
  /** The profile to open for a claimed suggestion. Null while unclaimed. */
  profileId: string | null;
  platform: string;
  platformLabel: string;
  /** With a leading @ for handle platforms. */
  handle: string;
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
  kind: 'profile' | 'claim';
  id: string;
  profileId: string | null;
  handle: string;
  name: string;
  platform: string;
  firstName: string | null;
  identityVerified: boolean;
  unclaimed: boolean;
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The canonical 0105 person key for a profile: the document key when there is
 * one, else the name+DOB key, else the profile id itself (an account with no
 * keys on file can still not vouch for itself, it just cannot be matched
 * across accounts).
 */
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
 * Autofill for /references: claimed members and unclaimed handles matching
 * `query` (handle, display name, or first name). Public-safe fields only.
 * Ranking: exact handle, then handle prefix, then name matches; within a
 * tier, most referenced first.
 */
export const searchReferences = withActionLog('references.searchReferences', async function searchReferences(
  query: string,
): Promise<ActionResult<ReferenceSuggestion[], 'persistence-error'>> {
  const needle = (query ?? '').trim().replace(/^@/, '').toLowerCase();
  const admin = createAdminClient();

  const claimsQuery = admin
    .from('social_claims')
    .select('id, platform, handle, claimed_profile_id')
    .order('handle', { ascending: true })
    .limit(60);
  const profilesQuery = admin
    .from('profiles')
    .select('id, display_name, identity_check_status, identity_check_name, region_code, avatar_path, fraud_banned_at, closed_at')
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

  const { data: profiles } = profileIds.length
    ? await admin
        .from('profiles')
        .select('id, display_name, identity_check_status, identity_check_name, region_code, avatar_path, fraud_banned_at, closed_at')
        .in('id', profileIds)
        .is('fraud_banned_at', null)
        .is('closed_at', null)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((row) => [row.id, row]));

  // Incoming live counts for everything on screen, tallied in one read.
  const { data: edges } = await admin
    .from('reference_edges_public')
    .select('target_profile_id, target_claim_id')
    .limit(5000);
  const countByProfile = new Map<string, number>();
  const countByClaim = new Map<string, number>();
  for (const edge of edges ?? []) {
    if (edge.target_profile_id) {
      countByProfile.set(edge.target_profile_id, (countByProfile.get(edge.target_profile_id) ?? 0) + 1);
    }
    if (edge.target_claim_id) {
      countByClaim.set(edge.target_claim_id, (countByClaim.get(edge.target_claim_id) ?? 0) + 1);
    }
  }

  const score = (handle: string, name: string): number => {
    if (!needle) return 1;
    const h = handle.toLowerCase().replace(/^@/, '');
    if (h === needle) return 0;
    if (h.startsWith(needle)) return 1;
    if (name.toLowerCase().includes(needle)) return 2;
    return 3;
  };

  const suggestions: (ReferenceSuggestion & { score: number })[] = [];

  for (const claim of claimRows) {
    const profile = claim.claimed_profile_id ? profileById.get(claim.claimed_profile_id) : null;
    if (claim.claimed_profile_id && !profile) continue; // banned/closed owner
    const handle = `@${claim.handle}`;
    suggestions.push({
      kind: profile ? 'profile' : 'claim',
      id: profile ? profile.id : claim.id,
      profileId: profile?.id ?? null,
      platform: claim.platform,
      platformLabel: platformLabel(claim.platform),
      handle,
      name: profile?.display_name ?? claim.handle,
      firstName:
        profile?.identity_check_status === 'VERIFIED'
          ? firstGivenName(profile.identity_check_name)
          : null,
      identityVerified: profile?.identity_check_status === 'VERIFIED',
      regionCode: profile?.region_code ?? null,
      avatarPath: profile?.avatar_path ?? null,
      referenceCount: profile
        ? (countByProfile.get(profile.id) ?? 0)
        : (countByClaim.get(claim.id) ?? 0),
      unclaimed: !profile,
      score: score(handle, profile?.display_name ?? claim.handle),
    });
  }

  // Members matched by name who have no claim in the result set.
  const claimedInSet = new Set(suggestions.map((s) => s.profileId).filter(Boolean));
  for (const profile of namedProfiles ?? []) {
    if (claimedInSet.has(profile.id) || !profileById.has(profile.id)) continue;
    suggestions.push({
      kind: 'profile',
      id: profile.id,
      profileId: profile.id,
      platform: 'noditto',
      platformLabel: 'NoDitto',
      handle: profile.display_name,
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
      score: score(profile.display_name, profile.display_name),
    });
  }

  return ok(
    suggestions
      .sort((a, b) => a.score - b.score || b.referenceCount - a.referenceCount || a.handle.localeCompare(b.handle))
      .slice(0, 8)
      .map(({ score: _score, ...rest }) => rest),
  );
});

// ---------------------------------------------------------------------------
// addUnclaimedHandle
// ---------------------------------------------------------------------------

/**
 * Add a person who is not on NoDitto yet: an unclaimed (platform, handle)
 * claim the caller can immediately vouch for. Idempotent — an existing claim
 * is returned as-is. The handle becomes unique from this moment.
 */
export const addUnclaimedHandle = withActionLog('references.addUnclaimedHandle', async function addUnclaimedHandle(input: {
  platform: string;
  handle: string;
}): Promise<ActionResult<ReferenceSuggestion, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in to add someone.');

  const handle = normalizeClaimHandle(input?.platform ?? '', input?.handle ?? '');
  if (!handle) {
    return fail('invalid-reference', "That handle doesn't look right. Use the username only, no @ or link.", 'handle');
  }

  const admin = createAdminClient();
  // Insert-then-read: the unique key includes the generated handle_norm, so
  // an upsert's ON CONFLICT target cannot name it. A 23505 means the claim
  // already exists, which is the idempotent outcome we want.
  const { data: inserted, error: insertError } = await admin
    .from('social_claims')
    .insert({ platform: input.platform, handle, created_by: user.id })
    .select('id, platform, handle, claimed_profile_id')
    .maybeSingle();
  if (insertError && insertError.code !== '23505') return fail('persistence-error', SAVE_FAILED);

  const row =
    inserted ??
    (
      await admin
        .from('social_claims')
        .select('id, platform, handle, claimed_profile_id')
        .eq('platform', input.platform)
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
    handle: `@${row.handle}`,
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
 * Give a reference: a positive attestation from an ID-verified member that
 * they personally dealt with the target. Goes LIVE immediately. A repeat for
 * the same pair of people adds a deal to the existing edge instead of a new
 * edge, so the people count cannot be inflated by one keen counterparty.
 */
export const giveReference = withActionLog('references.giveReference', async function giveReference(
  input: GiveReferenceInput,
): Promise<ActionResult<{ referenceId: string; addedDeal: boolean }, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in to give a reference.');

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
    return fail('not-allowed', "This account can't give references.");
  }
  if (voucher.identity_check_status !== 'VERIFIED') {
    return fail(
      'identity-unverified',
      'Verify your ID first — references only count from people who passed an ID check.',
    );
  }

  // Resolve the target to (profile?, claim?) plus its person key when claimed.
  let targetProfileId: string | null = null;
  let targetClaimId: string | null = null;
  let targetPersonKey: string | null = null;

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
  } else {
    const { data: claim } = await admin
      .from('social_claims')
      .select('id, handle, claimed_profile_id')
      .eq('id', target.claimId)
      .maybeSingle();
    if (!claim) return fail('not-found', "We couldn't find that handle.");
    if (claim.claimed_profile_id) {
      targetProfileId = claim.claimed_profile_id;
    } else {
      targetClaimId = claim.id;
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

  // A generous human pace; a ring hits it immediately.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const { count } = await admin
    .from('member_references')
    .select('id', { count: 'exact', head: true })
    .eq('voucher_id', user.id)
    .gte('created_at', dayStart.toISOString());
  if ((count ?? 0) >= REFERENCES_PER_DAY) {
    return fail('rate-limited', "You've given a lot of references today. Try again tomorrow.");
  }

  // Existing LIVE edge for this pair? Add a deal to it.
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
      title: sentiment === 'NEGATIVE' ? 'You received a negative experience' : 'You received a reference',
      body:
        sentiment === 'NEGATIVE'
          ? `${voucher.display_name} shared a negative experience about a deal on ${platformLabel(platform)}.`
          : `${voucher.display_name} referenced you: ${roleLabel(role).toLowerCase()} on ${platformLabel(platform)}.`,
      link: `/sellers/${targetProfileId}`,
    });
    revalidatePath(`/sellers/${targetProfileId}`);
  }
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

/** Mint a write token for one reference-proof screenshot, under the caller's folder. */
export const createReferenceProofUpload = withActionLog('references.createReferenceProofUpload', async function createReferenceProofUpload(
  contentType: string,
): Promise<ActionResult<{ path: string; token: string }, ReferenceError>> {
  return mintUpload(REFERENCE_PROOF_BUCKET, contentType);
});

/** Mint a write token for one handle-claim bio screenshot, under the caller's folder. */
export const createHandleClaimUpload = withActionLog('references.createHandleClaimUpload', async function createHandleClaimUpload(
  contentType: string,
): Promise<ActionResult<{ path: string; token: string }, ReferenceError>> {
  return mintUpload(HANDLE_CLAIM_EVIDENCE_BUCKET, contentType);
});

/**
 * Attach proof screenshots to your own LIVE positive reference. The
 * reference stays live; its proof goes to PENDING until staff mark it
 * CHECKED in /admin, which is what earns the receipt-checked display.
 */
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

/** The caller's claim request for a handle, if any. */
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

/**
 * Start (or resume) claiming an unclaimed handle: ID-verified members only.
 * Returns the bio code to put in the social bio; submitting a screenshot of
 * it (submitHandleClaim) sends the request to staff.
 */
export const startHandleClaim = withActionLog('references.startHandleClaim', async function startHandleClaim(
  claimId: string,
): Promise<ActionResult<MyHandleClaim, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in to claim this handle.');

  const admin = createAdminClient();
  const [{ data: profile }, { data: claim }] = await Promise.all([
    admin.from('profiles').select('identity_check_status, fraud_banned_at, closed_at').eq('id', user.id).maybeSingle(),
    admin.from('social_claims').select('id, claimed_profile_id').eq('id', claimId).maybeSingle(),
  ]);
  if (!profile || profile.fraud_banned_at || profile.closed_at) {
    return fail('not-allowed', "This account can't claim handles.");
  }
  if (profile.identity_check_status !== 'VERIFIED') {
    return fail('identity-unverified', 'Verify your ID first — a claimed handle carries your verified name.');
  }
  if (!claim) return fail('not-found', "We couldn't find that handle.");
  if (claim.claimed_profile_id) {
    return fail(
      'not-allowed',
      claim.claimed_profile_id === user.id ? 'You already claimed this handle.' : 'This handle is already claimed.',
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

/** Attach bio screenshots to your pending claim request and send it to staff. */
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

/** Withdraw your own LIVE reference. The edge leaves every count at once. */
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

/**
 * "I don't recognise this" — the target privately flags a reference for
 * staff. Nothing public changes; staff decide from the queue.
 */
export const disputeReference = withActionLog('references.disputeReference', async function disputeReference(
  referenceId: string,
): Promise<ActionResult<{ disputed: true }, ReferenceError>> {
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'Sign in first.');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('member_references')
    .update({ disputed_at: new Date().toISOString(), disputed_by: user.id, updated_at: new Date().toISOString() })
    .eq('id', referenceId)
    .eq('target_profile_id', user.id)
    .eq('status', 'LIVE')
    .select('id')
    .maybeSingle();
  if (error) return fail('persistence-error', SAVE_FAILED);
  if (!data) return fail('not-found', "That reference isn't about you.");
  return ok({ disputed: true });
});
