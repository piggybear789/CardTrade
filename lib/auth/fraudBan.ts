import 'server-only';

// lib/auth/fraudBan.ts
//
// Permanent ban after staff-confirmed Objective_Fraud.
//
// TWO LAYERS. The Profile + Auth ban locks this login (0059). The Identity
// person keys lock the HUMAN: a later account that verifies as the same
// government identity is refused before the Identity_Gate opens. Cash buyers
// never verify, so a banned scammer can still browse and buy under a new email
// until they hit Identity — that hole is recorded, not accidental.

import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import { regionForProfile } from '@/lib/regionBinding';

/** 100 years — Supabase's documented maximum practical permanent-ban duration. */
export const PERMANENT_FRAUD_BAN_DURATION = '876000h';

export type FraudBanResult =
  | { ok: true; alreadyBanned: boolean }
  | { ok: false; message: string };

/**
 * Permanently ban the offender of a staff-confirmed Objective_Fraud resolution.
 *
 * Locks the Profile and Auth user, then copies their Identity person keys onto
 * the blocklist and bans any other Profile that already carries those keys.
 */
export async function permanentlyBanConfirmedFraudOffender(params: {
  offenderId: string;
  staffId: string;
  tradeId: string;
}): Promise<FraudBanResult> {
  const banned = await enforceProfileFraudBan({
    profileId: params.offenderId,
    staffId: params.staffId,
    tradeId: params.tradeId,
  });
  if (!banned.ok) return banned;

  const listed = await blocklistIdentityOf(params);
  if (!listed.ok) return listed;

  return banned;
}

/**
 * Account-level ban only: profile flag, hide listings, Auth duration.
 *
 * Used by staff resolution AND by a later Identity verification that matches
 * the person blocklist. Idempotent.
 */
export async function enforceProfileFraudBan(params: {
  profileId: string;
  staffId?: string | null;
  tradeId?: string | null;
}): Promise<FraudBanResult> {
  const admin = createAdminClient();

  const { data: existing, error: readError } = await admin
    .from('profiles')
    .select('fraud_banned_at')
    .eq('id', params.profileId)
    .maybeSingle();

  if (readError || !existing) {
    return { ok: false, message: readError?.message ?? 'Offender profile was not found.' };
  }

  const alreadyBanned = existing.fraud_banned_at != null;
  if (!alreadyBanned) {
    const { error: profileError } = await admin
      .from('profiles')
      .update({
        fraud_banned_at: new Date().toISOString(),
        ...(params.staffId ? { fraud_banned_by: params.staffId } : {}),
        ...(params.tradeId ? { fraud_ban_trade_id: params.tradeId } : {}),
      })
      .eq('id', params.profileId)
      .is('fraud_banned_at', null);

    if (profileError) {
      return { ok: false, message: profileError.message };
    }
  }

  const { error: listingsError } = await admin
    .from('items')
    .update({ hidden: true })
    .eq('owner_id', params.profileId)
    .eq('status', 'AVAILABLE');

  if (listingsError) {
    return {
      ok: false,
      message:
        'The profile ban is active, but available listings could not be hidden: ' +
        listingsError.message,
    };
  }

  const { error: authError } = await admin.auth.admin.updateUserById(params.profileId, {
    ban_duration: PERMANENT_FRAUD_BAN_DURATION,
  });

  if (authError) {
    return {
      ok: false,
      message:
        'The profile ban is active, but the Supabase Auth ban could not be synced: ' +
        authError.message,
    };
  }

  return { ok: true, alreadyBanned };
}

/**
 * Copy this profile's Identity person keys onto the blocklist and ban every
 * other Profile that already has one of those keys.
 *
 * If this profile verified before person keys were stored, we re-read the
 * Identity session and stamp them now. No session / no usable outputs is not a
 * failure: the account ban still holds; person-matching cannot run.
 */
async function blocklistIdentityOf(params: {
  offenderId: string;
  staffId: string;
  tradeId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const admin = createAdminClient();

  await stampKeysFromIdentitySession(params.offenderId);

  const { data: keys, error: keyError } = await admin
    .from('identity_person_keys')
    .select('fingerprint')
    .eq('profile_id', params.offenderId);

  if (keyError) {
    return {
      ok: false,
      message:
        'The profile ban is active, but the Identity blocklist could not be read: ' +
        keyError.message,
    };
  }

  const fingerprints = [...new Set((keys ?? []).map((row) => row.fingerprint))];
  if (fingerprints.length === 0) return { ok: true };

  const { error: banError } = await admin.from('identity_bans').upsert(
    fingerprints.map((fingerprint) => ({
      fingerprint,
      banned_by: params.staffId,
      source_profile_id: params.offenderId,
      source_trade_id: params.tradeId,
    })),
    { onConflict: 'fingerprint', ignoreDuplicates: true },
  );

  if (banError) {
    return {
      ok: false,
      message:
        'The profile ban is active, but the Identity blocklist could not be written: ' +
        banError.message,
    };
  }

  const { data: others, error: othersError } = await admin
    .from('identity_person_keys')
    .select('profile_id')
    .in('fingerprint', fingerprints)
    .neq('profile_id', params.offenderId);

  if (othersError) {
    return {
      ok: false,
      message:
        'The profile ban is active, but matching accounts could not be scanned: ' +
        othersError.message,
    };
  }

  const otherIds = [...new Set((others ?? []).map((row) => row.profile_id))];
  for (const profileId of otherIds) {
    const cascaded = await enforceProfileFraudBan({
      profileId,
      staffId: params.staffId,
      tradeId: params.tradeId,
    });
    if (!cascaded.ok) return cascaded;
  }

  return { ok: true };
}

async function stampKeysFromIdentitySession(profileId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('identity_check_session_id')
    .eq('id', profileId)
    .maybeSingle();

  const sessionId = profile?.identity_check_session_id ?? null;
  if (!sessionId) return;

  const payments = getPaymentService(await regionForProfile(profileId));
  if (!payments.readIdentityCheck) return;

  try {
    const check = await payments.readIdentityCheck(sessionId);
    const prints = check.identityFingerprints ?? [];
    if (prints.length === 0) return;
    await admin.from('identity_person_keys').upsert(
      prints.map((print) => ({
        fingerprint: print.hash,
        profile_id: profileId,
        kind: print.kind,
      })),
      { onConflict: 'fingerprint,profile_id', ignoreDuplicates: true },
    );
  } catch {
    // Best-effort: the account ban already landed. A read failure must not
    // unwind it, and must not log verified_outputs.
  }
}
