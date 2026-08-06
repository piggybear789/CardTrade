// lib/auth/fraudBan.ts
//
// Permanent account-ban enforcement after staff-confirmed Objective_Fraud.
//
// This helper is deliberately server-only and may only be called after the staff
// fraud resolver has committed FRAUD_CONFIRMED and identified the offending trader.
// The profile record blocks active sessions immediately; Supabase Auth receives the
// matching 100-year ban so fresh sign-ins fail too.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/** 100 years — Supabase's documented maximum practical permanent-ban duration. */
export const PERMANENT_FRAUD_BAN_DURATION = '876000h';

export type FraudBanResult =
  | { ok: true; alreadyBanned: boolean }
  | { ok: false; message: string };

/**
 * Permanently ban the offender of a staff-confirmed Objective_Fraud resolution.
 *
 * The profile ban is written first because middleware and restrictive RLS policies
 * enforce it immediately, even if Auth is temporarily unavailable. The Auth ban is
 * then applied with the same permanent duration to reject future sign-ins.
 */
export async function permanentlyBanConfirmedFraudOffender(params: {
  offenderId: string;
  staffId: string;
  tradeId: string;
}): Promise<FraudBanResult> {
  const admin = createAdminClient();

  const { data: existing, error: readError } = await admin
    .from('profiles')
    .select('fraud_banned_at')
    .eq('id', params.offenderId)
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
        fraud_banned_by: params.staffId,
        fraud_ban_trade_id: params.tradeId,
      })
      .eq('id', params.offenderId)
      .is('fraud_banned_at', null);

    if (profileError) {
      return { ok: false, message: profileError.message };
    }
  }

  // A permanent ban also removes currently available inventory from the public
  // catalog. It leaves reserved/sold items intact for historical contracts.
  const { error: listingsError } = await admin
    .from('items')
    .update({ hidden: true })
    .eq('owner_id', params.offenderId)
    .eq('status', 'AVAILABLE');

  if (listingsError) {
    return {
      ok: false,
      message:
        'The profile ban is active, but available listings could not be hidden: ' +
        listingsError.message,
    };
  }

  const { error: authError } = await admin.auth.admin.updateUserById(params.offenderId, {
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
