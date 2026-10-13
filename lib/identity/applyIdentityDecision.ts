import 'server-only';

// lib/identity/applyIdentityDecision.ts
//
// Single writer for an Identity session outcome. Both the hosted return
// (`refreshIdentityCheck`) and the Identity webhook come through here so a
// banned PERSON cannot become VERIFIED on a new Profile.
//
// Order: stamp person keys → if any key is blocklisted, account-ban and leave
// the gate closed → otherwise write VERIFIED. The raw document fields never
// reach this module; only HMAC hex from `IdentityCheck.identityFingerprints`.

import { createAdminClient } from '@/lib/supabase/admin';
import type { IdentityCheck } from '@/domain/services/types';
import type { IdentityCheckStatus } from '@/domain/identity/identityGate';
import { enforceProfileFraudBan } from '@/lib/auth/fraudBan';
import { logBackgroundFailure } from '@/lib/errors/errorLog';

/** `duplicate`: ESC-24, held PENDING because another live account is the same person. */
export type IdentityDecision = 'verified' | 'blocked' | 'failed' | 'pending' | 'duplicate';

export async function applyIdentityDecision(params: {
  profileId: string;
  check: IdentityCheck;
  occurredAt?: string;
  /**
   * ESC-24: staff approved this member despite a duplicate identity (the older
   * account is closed). Skips the duplicate hold and records the approver. A ban
   * still wins.
   */
  staffOverride?: { staffId: string };
}): Promise<IdentityDecision> {
  const admin = createAdminClient();
  const fingerprints = params.check.identityFingerprints ?? [];
  let liveDuplicateOf: string | null = null;

  // ESC-15: a VERIFIED session that came back without its document number has no
  // document person key, so a banned person could pass. Verification still proceeds
  // (our configuration must not block honest members), but it is logged, and the
  // profile is marked so the `:17` job can backfill the keys inside Stripe's 48-hour
  // window.
  if (params.check.outcome === 'VERIFIED') {
    if (params.check.personKeysUnavailable) {
      await logBackgroundFailure({
        name: 'identity.person_keys',
        errorCode: 'PERSON_KEYS_UNAVAILABLE',
        message: 'Identity verified without a document number; person keys are incomplete.',
        context: { profileId: params.profileId },
      });
      await admin
        .from('profiles')
        .update({ identity_keys_missing_at: new Date().toISOString() })
        .eq('id', params.profileId)
        .is('identity_keys_missing_at', null);
    } else if (fingerprints.some((print) => print.kind === 'document-id')) {
      await admin
        .from('profiles')
        .update({ identity_keys_missing_at: null })
        .eq('id', params.profileId)
        .not('identity_keys_missing_at', 'is', null);
    }
  }

  if (fingerprints.length > 0) {
    const { error: stampError } = await admin.from('identity_person_keys').upsert(
      fingerprints.map((print) => ({
        fingerprint: print.hash,
        profile_id: params.profileId,
        kind: print.kind,
      })),
      { onConflict: 'fingerprint,profile_id', ignoreDuplicates: true },
    );
    if (stampError) throw stampError;

    const hashes = fingerprints.map((print) => print.hash);

    const { data: banned, error: banReadError } = await admin
      .from('identity_bans')
      .select('fingerprint, banned_by, source_trade_id, source_profile_id')
      .in('fingerprint', hashes)
      .limit(1);
    if (banReadError) throw banReadError;

    let block = banned?.[0] ?? null;

    if (!block) {
      const { data: siblings, error: siblingError } = await admin
        .from('identity_person_keys')
        .select('profile_id')
        .in('fingerprint', hashes)
        .neq('profile_id', params.profileId);
      if (siblingError) throw siblingError;

      const siblingIds = [...new Set((siblings ?? []).map((row) => row.profile_id))];
      if (siblingIds.length > 0 && !params.staffOverride) {
        // ESC-24: the same verified person on another LIVE account (not banned, not
        // closed). Remembered here; acted on below, after the ban check wins.
        const { data: live, error: liveError } = await admin
          .from('profiles')
          .select('id')
          .in('id', siblingIds)
          .is('fraud_banned_at', null)
          .is('closed_at', null)
          .limit(1);
        if (liveError) throw liveError;
        liveDuplicateOf = (live?.[0]?.id as string | undefined) ?? null;
      }
      if (siblingIds.length > 0) {
        const { data: bannedSiblings, error: siblingBanError } = await admin
          .from('profiles')
          .select('id, fraud_banned_by, fraud_ban_trade_id')
          .in('id', siblingIds)
          .not('fraud_banned_at', 'is', null)
          .limit(1);
        if (siblingBanError) throw siblingBanError;
        const sibling = bannedSiblings?.[0];
        if (sibling) {
          block = {
            fingerprint: hashes[0]!,
            banned_by: sibling.fraud_banned_by,
            source_trade_id: sibling.fraud_ban_trade_id,
            source_profile_id: sibling.id,
          };
        }
      }
    }

    if (block) {
      await admin.from('identity_bans').upsert(
        hashes.map((fingerprint) => ({
          fingerprint,
          banned_by: block.banned_by,
          source_profile_id: block.source_profile_id ?? params.profileId,
          source_trade_id: block.source_trade_id,
        })),
        { onConflict: 'fingerprint', ignoreDuplicates: true },
      );
      await enforceProfileFraudBan({
        profileId: params.profileId,
        staffId: block.banned_by,
        tradeId: block.source_trade_id,
      });
      return 'blocked';
    }
  }

  // ESC-24: one person, two live accounts. Not VERIFIED: held PENDING for staff,
  // who approve only once the older account is closed (`resolveDuplicateIdentity`).
  // The member is told only that support needs to check something.
  if (params.check.outcome === 'VERIFIED' && liveDuplicateOf) {
    const { error } = await admin
      .from('profiles')
      .update({
        identity_check_status: 'PENDING',
        identity_duplicate_of: liveDuplicateOf,
        ...(params.check.sessionId ? { identity_check_session_id: params.check.sessionId } : {}),
      })
      .eq('id', params.profileId)
      .neq('identity_check_status', 'VERIFIED');
    if (error) throw error;
    await logBackgroundFailure({
      name: 'identity.duplicate',
      errorCode: 'DUPLICATE_IDENTITY',
      message: 'A verified identity already belongs to another live account; held for staff.',
      context: { profileId: params.profileId },
    });
    return 'duplicate';
  }

  const status: IdentityCheckStatus =
    params.check.outcome === 'VERIFIED'
      ? 'VERIFIED'
      : params.check.outcome === 'FAILED'
        ? 'FAILED'
        : 'PENDING';

  const verifiedAt = params.check.verifiedAt ?? params.occurredAt ?? null;

  let update = admin
    .from('profiles')
    .update({
      identity_check_status: status,
      ...(params.check.sessionId
        ? { identity_check_session_id: params.check.sessionId }
        : {}),
      ...(status === 'VERIFIED' && verifiedAt
        ? { identity_check_verified_at: verifiedAt }
        : {}),
      ...(params.check.verifiedName
        ? { identity_check_name: params.check.verifiedName }
        : {}),
      // ESC-24: a staff-approved duplicate records who approved it.
      ...(params.staffOverride && status === 'VERIFIED'
        ? {
            identity_duplicate_approved_by: params.staffOverride.staffId,
            identity_duplicate_approved_at: new Date().toISOString(),
          }
        : {}),
    })
    .eq('id', params.profileId);

  if (status !== 'VERIFIED') {
    update = update.neq('identity_check_status', 'VERIFIED');
  }

  const { error } = await update;
  if (error) throw error;

  if (status === 'VERIFIED') return 'verified';
  if (status === 'FAILED') return 'failed';
  return 'pending';
}
