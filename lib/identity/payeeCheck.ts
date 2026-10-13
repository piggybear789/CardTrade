// lib/identity/payeeCheck.ts
//
// Compare the payout account's name with the verified ID and record the answer
// (ESC-25). Called from every payout read-back (`refreshPayoutStatus`).
//
// MISMATCH sets `payee_identity_mismatch_at` and payouts stop (`canReceiveFunds`);
// MATCH clears it; UNAVAILABLE (the provider did not expose the payee name) is logged
// once per member and never flags, because failing closed on a provider shape change
// would stop every payout; CLEARED keeps a staff clearance for exactly that pair.
//
// `server-only`, not a Server Action.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { decidePayeeMatch, splitFullName, type NameParts, type PayeeMatchDecision } from '@/domain/identity/payeeNameMatch';

type AdminClient = ReturnType<typeof createAdminClient>;

function pairSecret(): string {
  return process.env.IDENTITY_FINGERPRINT_SECRET?.trim() || process.env.STRIPE_SECRET_KEY?.trim() || '';
}

export async function applyPayeeNameCheck(
  profileId: string,
  payeeName: NameParts | null | undefined,
  client: AdminClient = createAdminClient(),
): Promise<PayeeMatchDecision | null> {
  const { data, error } = await client
    .from('profiles')
    .select('identity_check_name, payee_mismatch_cleared_pair, payee_name_unavailable_logged_at, payee_identity_mismatch_at')
    .eq('id', profileId)
    .maybeSingle();
  if (error || !data) {
    await logBackgroundFailure({ name: 'payout.payee_name', errorCode: 'READ_FAILED', message: error?.message, context: { profileId } });
    return null;
  }
  const row = data as {
    identity_check_name: string | null;
    payee_mismatch_cleared_pair: string | null;
    payee_name_unavailable_logged_at: string | null;
    payee_identity_mismatch_at: string | null;
  };
  const decision = decidePayeeMatch({
    identityName: splitFullName(row.identity_check_name),
    payeeName: payeeName ?? null,
    clearedPair: row.payee_mismatch_cleared_pair,
    secret: pairSecret(),
  });

  const now = new Date().toISOString();
  if (decision === 'MISMATCH' && !row.payee_identity_mismatch_at) {
    await client.from('profiles').update({ payee_identity_mismatch_at: now }).eq('id', profileId);
    await logBackgroundFailure({
      name: 'payout.payee_name',
      errorCode: 'PAYEE_IDENTITY_MISMATCH',
      message: 'The payout account name does not match the verified ID; payouts are paused.',
      context: { profileId },
    });
  } else if ((decision === 'MATCH' || decision === 'CLEARED') && row.payee_identity_mismatch_at) {
    await client.from('profiles').update({ payee_identity_mismatch_at: null }).eq('id', profileId);
  } else if (decision === 'UNAVAILABLE' && !row.payee_name_unavailable_logged_at) {
    await logBackgroundFailure({
      name: 'payout.payee_name',
      errorCode: 'PAYEE_NAME_UNAVAILABLE',
      message: 'The provider did not return the payout account name, so it could not be compared.',
      context: { profileId },
    });
    await client.from('profiles').update({ payee_name_unavailable_logged_at: now }).eq('id', profileId);
  }
  return decision;
}
