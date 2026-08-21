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

export type IdentityDecision = 'verified' | 'blocked' | 'failed' | 'pending';

export async function applyIdentityDecision(params: {
  profileId: string;
  check: IdentityCheck;
  occurredAt?: string;
}): Promise<IdentityDecision> {
  const admin = createAdminClient();
  const fingerprints = params.check.identityFingerprints ?? [];

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
