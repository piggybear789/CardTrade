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
import { revalidatePath, updateTag } from 'next/cache';

import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { withActionLog } from '@/lib/errors/withActionLog';
import { instagramBotHandle, isInstagramBotHandle } from '@/lib/instagram/botHandle';
import { getInstagramBotToken } from '@/lib/instagram/botToken';
import { REFERENCES_CACHE_TAG } from '@/lib/references/cacheTag';
import {
  searchNeedle,
  searchSuggestions,
  type ReferenceSuggestion,
} from '@/lib/references/search';
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
  isAllowedReferenceImageType,
} from '@/lib/storage/referenceImagesShared';
import { satisfiesIdentityGate, type IdentityCheckStatus } from '@/domain/identity/identityGate';
import {
  REFERENCES_PER_DAY,
  REFERENCE_SENTIMENTS,
  dealsThroughAfter,
  isAnotherDeal,
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

export type { ReferenceSuggestion } from '@/lib/references/search';
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

/**
 * The person a profile belongs to (`pickPersonKey`), or null when the read failed. Never
 * guessed on a failure: `profile:<id>` for a member who HAS identity keys would slip past
 * the person-level dedupe and self check.
 */
async function personKeyFor(admin: Admin, profileId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('identity_person_keys')
    .select('fingerprint, kind')
    .eq('profile_id', profileId);
  if (error) return null;
  return pickPersonKey(profileId, data ?? []);
}

/** The Identity_Gate, evaluated in its one place. */
function passesIdentityGate(status: string | null | undefined): boolean {
  return satisfiesIdentityGate({ identityCheckStatus: (status ?? 'NONE') as IdentityCheckStatus });
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

/**
 * Autofill for `/references` and the header search (`lib/references/search.ts`), rate
 * limited per visitor. With no query: the people and handles the most people have had a
 * good experience of lately.
 */
export const searchReferences = withActionLog('references.searchReferences', async function searchReferences(
  query: string,
): Promise<ActionResult<ReferenceSuggestion[], 'persistence-error' | 'rate-limited'>> {
  if (!(await referenceSearchLimiter.check(await rateLimitIdentifier(null))).allowed) {
    return fail('rate-limited', 'Too many searches. Wait a moment and try again.');
  }
  try {
    return ok(await searchSuggestions(searchNeedle(query)));
  } catch {
    return fail('persistence-error', "We couldn't search references just now. Please try again.");
  }
});

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
  if (!passesIdentityGate(voucher.identity_check_status)) {
    return fail(
      'identity-unverified',
      'Verify your ID first so every experience comes from a verified person.',
    );
  }

  // Who it is for. A claimed handle's references belong to its claimant.
  let targetProfileId: string | null = null;
  let targetClaimId: string | null = null;
  // The handle it was left FOR, kept even when that handle is claimed (0165).
  let originClaimId: string | null = null;
  if (target.kind === 'profile') {
    targetProfileId = target.profileId;
  } else {
    const claim =
      target.kind === 'claim'
        ? await (async () => {
            const { data, error } = await admin
              .from('social_claims')
              .select('id, claimed_profile_id')
              .eq('id', target.claimId)
              .maybeSingle();
            return error ? undefined : data;
          })()
        : await findOrCreateClaim(admin, target.platform, target.handle, user.id);
    if (claim === undefined) return fail('persistence-error', SAVE_FAILED);
    if (!claim) {
      return target.kind === 'claim'
        ? fail('not-found', "We couldn't find that handle.")
        : fail('persistence-error', SAVE_FAILED);
    }
    originClaimId = claim.id;
    if (claim.claimed_profile_id) targetProfileId = claim.claimed_profile_id;
    else targetClaimId = claim.id;
  }

  let targetPersonKey: string | null = null;
  const voucherPersonKey = await personKeyFor(admin, user.id);
  if (!voucherPersonKey) return fail('persistence-error', SAVE_FAILED);
  if (targetProfileId) {
    if (targetProfileId === user.id) {
      return fail('self-reference', "You can't give yourself a reference.");
    }
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, fraud_banned_at, closed_at')
      .eq('id', targetProfileId)
      .maybeSingle();
    if (profileError) return fail('persistence-error', SAVE_FAILED);
    if (!profile || profile.fraud_banned_at || profile.closed_at) {
      return fail('not-found', "We couldn't find that person.");
    }
    targetPersonKey = await personKeyFor(admin, targetProfileId);
    if (!targetPersonKey) return fail('persistence-error', SAVE_FAILED);
    if (targetPersonKey === voucherPersonKey) {
      return fail('self-reference', "You can't give yourself a reference.");
    }
  }

  // The day is UTC, the server's clock on Vercel.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count, error: countError } = await admin
    .from('member_references')
    .select('id', { count: 'exact', head: true })
    .eq('voucher_id', user.id)
    .gte('created_at', dayStart.toISOString());
  if (countError) return fail('persistence-error', SAVE_FAILED);
  if ((count ?? 0) >= REFERENCES_PER_DAY) {
    return fail('rate-limited', "You've posted a lot of references today. Try again tomorrow.");
  }

  const existingQuery = admin
    .from('member_references')
    .select('id, deal_count, occurred_month, deals_through, platform, role, proof_status')
    .eq('status', 'LIVE');
  const { data: existing, error: existingError } = targetPersonKey
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
  if (existingError) return fail('persistence-error', SAVE_FAILED);

  if (existing) {
    // A LATER MONTH THAN ANY ALREADY COUNTED IS ANOTHER DEAL; anything else is a deal
    // told again, so publishing over and over, or rewinding the month first, can never
    // raise the count (`isAnotherDeal`).
    const addedDeal = isAnotherDeal(occurredMonth, {
      occurredMonth: existing.occurred_month,
      dealsThrough: existing.deals_through,
    });
    const now = new Date().toISOString();
    const nextMonth = addedDeal ? occurredMonth : existing.occurred_month;
    const { error } = await admin
      .from('member_references')
      .update({
        deal_count: addedDeal ? existing.deal_count + 1 : existing.deal_count,
        platform,
        rating,
        category,
        comment,
        role,
        occurred_month: nextMonth,
        deals_through: dealsThroughAfter(nextMonth, existing.deals_through),
        // A receipt was checked against the deal it was attached to. Retold as a
        // different deal (platform or role), it goes back to staff.
        ...(!addedDeal && receiptNeedsRecheck(existing, { platform, role, occurredMonth: nextMonth })
          ? { proof_status: 'PENDING' as const }
          : {}),
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
      deals_through: occurredMonth,
      origin_claim_id: originClaimId,
      voucher_person_key: voucherPersonKey,
      target_person_key: targetPersonKey,
    })
    .select('id')
    .single();
  if (insertError || !inserted) return fail('persistence-error', SAVE_FAILED);

  if (targetProfileId && !(await notifiedRecently(admin, user.id, targetProfileId, sentiment, inserted.id))) {
    await notifyReferenced(targetProfileId, voucher.display_name, sentiment, platform, role);
  }
  revalidateReferences(targetProfileId);
  return ok({ referenceId: inserted.id, addedDeal: false });
});

/** How long one author's experiences of one member notify them only once per kind. */
const NOTIFY_QUIET_DAYS = 30;

/**
 * Whether this author already told this member about an experience of this kind lately.
 * Withdrawing and posting again would otherwise send the same "negative experience"
 * notice over and over. A failed read reads as "yes": a missed notice beats a flood.
 */
async function notifiedRecently(
  admin: Admin,
  authorId: string,
  targetProfileId: string,
  sentiment: ReferenceSentiment,
  exceptId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - NOTIFY_QUIET_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from('member_references')
    .select('id', { count: 'exact', head: true })
    .eq('voucher_id', authorId)
    .eq('target_profile_id', targetProfileId)
    .eq('sentiment', sentiment)
    .neq('id', exceptId)
    .gte('created_at', since);
  return error ? true : (count ?? 0) > 0;
}

/** Tell a member someone shared an experience of them. */
async function notifyReferenced(
  targetProfileId: string,
  authorName: string,
  sentiment: ReferenceSentiment,
  platform: string,
  role: string,
): Promise<void> {
  await createNotification({
    userId: targetProfileId,
    type: 'SYSTEM',
    title: sentiment === 'NEGATIVE' ? 'You received a negative experience' : 'You received a reference',
    body:
      sentiment === 'NEGATIVE'
        ? `${authorName} shared a negative experience about a deal on ${platformLabel(platform)}.`
        : `${authorName} referenced you: ${roleLabel(role).toLowerCase()} on ${platformLabel(platform)}.`,
    link: `/sellers/${targetProfileId}`,
  });
}

/**
 * Whether a receipt staff checked (or are checking) no longer matches the deal it backs:
 * the platform, the role or the month changed. Its words and rating may change freely.
 */
function receiptNeedsRecheck(
  existing: { proof_status: string; platform: string; role: string; occurred_month: string },
  next: { platform: string; role: string; occurredMonth: string },
): boolean {
  if (existing.proof_status !== 'CHECKED') return false;
  return (
    existing.platform !== next.platform ||
    existing.role !== next.role ||
    existing.occurred_month.slice(0, 10) !== next.occurredMonth.slice(0, 10)
  );
}

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
  if (!isAllowedReferenceImageType((contentType ?? '').toLowerCase())) {
    return fail('invalid-reference', 'Add a screenshot or photo (JPG, PNG, WebP or HEIC).');
  }
  try {
    return ok(await createSignedReferenceUpload(createAdminClient(), bucket, user.id, contentType));
  } catch {
    // Storage's own error text is not for members.
    return fail('persistence-error', 'Could not prepare the upload. Please try again.');
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
  if (!(await referenceWriteLimiter.check(user.id)).allowed) return fail('rate-limited', RATE_LIMITED);

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

  const { data: before, error: beforeError } = await admin
    .from('member_references')
    .select('proof_paths')
    .eq('id', referenceId)
    .eq('voucher_id', user.id)
    .eq('status', 'LIVE')
    .maybeSingle();
  if (beforeError) return fail('persistence-error', SAVE_FAILED);
  if (!before) return fail('not-found', "That reference isn't yours.");

  const nextPaths = verifiedPaths.slice(0, 5);
  const { data, error } = await admin
    .from('member_references')
    .update({
      proof_paths: nextPaths,
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
  // Screenshots this proof replaced are deleted rather than left in the bucket.
  await removeProofImages(
    admin,
    before.proof_paths.filter((path) => !nextPaths.includes(path)),
    referenceId,
  );
  revalidateReferences(data.target_profile_id);
  return ok({ attached: true });
});

/** Delete proof screenshots; a failure is logged, never shown, since the write stood. */
async function removeProofImages(admin: Admin, paths: readonly string[], referenceId: string): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await admin.storage.from(REFERENCE_PROOF_BUCKET).remove([...paths]);
  if (error) {
    await logBackgroundFailure({
      name: 'references.proof.delete',
      errorCode: 'STORAGE_REMOVE_FAILED',
      message: error.message,
      context: { referenceId },
    });
  }
}

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
function deterministicDmCode(handleNorm: string, claimantId: string): string | null {
  // A dedicated key, never a credential or a public value: anyone who knows the key can
  // compute a claimant's code. `IDENTITY_FINGERPRINT_SECRET` is the fallback because it
  // is already a server-only HMAC key; the `ig-dm:` prefix keeps the two uses apart.
  const secret = process.env.INSTAGRAM_DM_CODE_SECRET || process.env.IDENTITY_FINGERPRINT_SECRET;
  if (!secret) return null;
  const digest = createHmac('sha256', secret).update(`ig-dm:${handleNorm}:${claimantId}`).digest();
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += DM_CODE_ALPHABET[digest[i] % DM_CODE_ALPHABET.length];
  }
  return `ND-${suffix}`;
}

/** Logged once per attempt when no key is configured, so the dead claim path is visible. */
async function logMissingDmSecret(): Promise<void> {
  await logBackgroundFailure({
    name: 'references.instagram_dm.code',
    errorCode: 'NO_CODE_SECRET',
    message: 'INSTAGRAM_DM_CODE_SECRET (or IDENTITY_FINGERPRINT_SECRET) is not set',
  });
}

const DM_UNAVAILABLE = "Instagram claims aren't available right now. Try another way to claim.";

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
    if (!code) {
      await logMissingDmSecret();
      return fail('persistence-error', DM_UNAVAILABLE);
    }

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

    const { data: existingReq, error: existingError } = await admin
      .from('handle_claim_requests')
      .select('id, bio_code, status')
      .eq('claim_id', claim.id)
      .eq('claimant_id', user.id)
      .eq('status', 'PENDING')
      .maybeSingle();
    if (existingError) return fail('persistence-error', SAVE_FAILED);

    if (existingReq) {
      if (existingReq.bio_code !== code) {
        const { error } = await admin
          .from('handle_claim_requests')
          .update({ bio_code: code, updated_at: new Date().toISOString() })
          .eq('id', existingReq.id);
        if (error) return fail('persistence-error', SAVE_FAILED);
      }
      return ok({ code, botHandle, signedIn: true, status: 'PENDING' });
    }

    const { error: insertError } = await admin.from('handle_claim_requests').insert({
      claim_id: claim.id,
      claimant_id: user.id,
      bio_code: code,
    });
    // 23505: a second tab opened the same request a moment earlier.
    if (insertError && insertError.code !== '23505') return fail('persistence-error', SAVE_FAILED);

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

    const { data: claim, error: claimLookupError } = await admin
      .from('social_claims')
      .select('id, claimed_profile_id')
      .eq('platform', 'instagram')
      .eq('handle_norm', handleNorm)
      .maybeSingle();
    if (claimLookupError) return fail('persistence-error', SAVE_FAILED);

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
    if (!code) {
      await logMissingDmSecret();
      return fail('persistence-error', DM_UNAVAILABLE);
    }
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
            claimant_message: note,
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
            claimant_message: note,
          })
          .select('id')
          .single();

    if (error || !data) return fail('persistence-error', SAVE_FAILED);

    revalidateReferences(user.id);
    return ok({ requestId: data.id });
  },
);

// ---------------------------------------------------------------------------
// edit / withdraw
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
    .select('display_name, fraud_banned_at, closed_at')
    .eq('id', user.id)
    .maybeSingle();
  if (authorError) return fail('persistence-error', SAVE_FAILED);
  if (!author || author.fraud_banned_at || author.closed_at) {
    return fail('not-allowed', "This account can't change references.");
  }

  const { data: reference, error: loadError } = await admin
    .from('member_references')
    .select(
      'id, sentiment, voucher_person_key, target_person_key, target_profile_id, target_claim_id, platform, role, occurred_month, deals_through, proof_status',
    )
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
    const { data: clash, error: clashError } = reference.target_person_key
      ? await others
          .eq('voucher_person_key', reference.voucher_person_key)
          .eq('target_person_key', reference.target_person_key)
          .limit(1)
          .maybeSingle()
      : reference.target_claim_id
        ? await others
            .eq('voucher_id', user.id)
            .eq('target_claim_id', reference.target_claim_id)
            .limit(1)
            .maybeSingle()
        : await others
            .eq('voucher_id', user.id)
            .eq('target_profile_id', reference.target_profile_id!)
            .limit(1)
            .maybeSingle();
    if (clashError) return fail('persistence-error', SAVE_FAILED);
    if (clash) return fail('invalid-reference', clashMessage, 'rating');
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from('member_references')
    .update({
      platform,
      role,
      occurred_month: occurredMonth,
      // Never lowered: a rewound month must not let the next post count as a new deal.
      deals_through: dealsThroughAfter(occurredMonth, reference.deals_through),
      rating,
      sentiment,
      category,
      comment,
      // A checked receipt no longer backs a deal told differently: back to staff.
      ...(receiptNeedsRecheck(reference, { platform, role, occurredMonth })
        ? { proof_status: 'PENDING' as const }
        : {}),
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
  // Turning a reference negative is news to its subject, exactly as posting one is.
  if (
    sentiment === 'NEGATIVE' &&
    reference.sentiment !== 'NEGATIVE' &&
    reference.target_profile_id &&
    !(await notifiedRecently(admin, user.id, reference.target_profile_id, sentiment, reference.id))
  ) {
    await notifyReferenced(reference.target_profile_id, author.display_name, sentiment, platform, role);
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
    .select('target_profile_id, proof_paths')
    .maybeSingle();
  if (error) return fail('persistence-error', SAVE_FAILED);
  if (!data) return fail('not-found', "That reference isn't yours to withdraw.");
  // A withdrawn reference's receipts back nothing any more; they are often screenshots
  // of someone's chat, so they are not kept.
  await removeProofImages(admin, data.proof_paths, referenceId);
  revalidateReferences(data.target_profile_id);
  return ok({ withdrawn: true });
});
