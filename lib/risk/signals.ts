// lib/risk/signals.ts
//
// The service-role store behind the related-account refusal and the card blocklist
// (ESC-03 layer 3, ESC-14; tables from 0140).
//
// `server-only`, NOT a Server Action: every export of a `'use server'` module is an
// endpoint, and "is this member related to that one" must never be one.
//
// Values are HMACs keyed with the identity fingerprint secret, so a raw card or bank
// fingerprint is never stored. Every read checks `{ error }`; a failed read refuses
// nothing (it logs), because these are fraud brakes layered on escrow, and an
// unreadable signal store must not stop honest members trading.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { logBackgroundFailure } from '@/lib/errors/errorLog';
import {
  EMPTY_SIGNALS,
  areRelated,
  riskSignalHash,
  type RiskSignalKind,
  type SignalSet,
} from '@/domain/risk/relatedAccounts';

type AdminClient = ReturnType<typeof createAdminClient>;

/** The same secret the identity person keys use. Empty disables signals. */
function signalSecret(): string {
  return process.env.IDENTITY_FINGERPRINT_SECRET?.trim() || process.env.STRIPE_SECRET_KEY?.trim() || '';
}

/** Record one provider fingerprint against a member. Never throws. */
export async function recordRiskSignal(
  profileId: string,
  kind: RiskSignalKind,
  rawFingerprint: string | null | undefined,
  client: AdminClient = createAdminClient(),
): Promise<string | null> {
  if (!rawFingerprint) return null;
  const hash = riskSignalHash(kind, rawFingerprint, signalSecret());
  if (!hash) return null;
  const { error } = await client
    .from('member_risk_signals')
    .upsert({ profile_id: profileId, kind, value_hash: hash }, { onConflict: 'profile_id,kind,value_hash', ignoreDuplicates: true });
  if (error) {
    await logBackgroundFailure({ name: 'risk.signal', errorCode: 'WRITE_FAILED', message: error.message, context: { profileId } });
    return null;
  }
  return hash;
}

/** One member's signals plus their identity person keys. Empty on a failed read. */
export async function loadSignals(profileId: string, client: AdminClient = createAdminClient()): Promise<SignalSet> {
  const [signals, keys] = await Promise.all([
    client.from('member_risk_signals').select('kind, value_hash').eq('profile_id', profileId),
    client.from('identity_person_keys').select('fingerprint').eq('profile_id', profileId),
  ]);
  if (signals.error || keys.error) {
    await logBackgroundFailure({
      name: 'risk.signal',
      errorCode: 'READ_FAILED',
      message: (signals.error ?? keys.error)?.message,
      context: { profileId },
    });
    return EMPTY_SIGNALS;
  }
  const rows = (signals.data ?? []) as Array<{ kind: RiskSignalKind; value_hash: string }>;
  return {
    cardHashes: rows.filter((r) => r.kind === 'CARD_FINGERPRINT').map((r) => r.value_hash),
    payoutHashes: rows.filter((r) => r.kind === 'PAYOUT_ACCOUNT_FINGERPRINT').map((r) => r.value_hash),
    personKeys: ((keys.data ?? []) as Array<{ fingerprint: string }>).map((r) => r.fingerprint),
  };
}

/** ESC-03 layer 3: do the two members share a card, payout account or person? */
export async function membersAreRelated(
  a: string,
  b: string,
  client: AdminClient = createAdminClient(),
): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const [left, right] = await Promise.all([loadSignals(a, client), loadSignals(b, client)]);
  return areRelated(left, right);
}

/**
 * Which of `buyerIds` are related to `sellerId` (ESC-03 layer 3). A sale to a related
 * buyer never counts toward the seller being "established". The seller's signals are
 * read once.
 */
export async function relatedBuyers(
  sellerId: string,
  buyerIds: readonly string[],
  client: AdminClient = createAdminClient(),
): Promise<Set<string>> {
  const unique = [...new Set(buyerIds)].filter((id) => id && id !== sellerId);
  if (unique.length === 0) return new Set();
  const seller = await loadSignals(sellerId, client);
  const related = new Set<string>();
  for (const buyerId of unique) {
    if (areRelated(seller, await loadSignals(buyerId, client))) related.add(buyerId);
  }
  return related;
}

/** ESC-14: is a card hash on the blocklist? */
export async function isCardHashBlocked(hash: string, client: AdminClient = createAdminClient()): Promise<boolean> {
  const { data, error } = await client
    .from('blocked_payment_fingerprints')
    .select('value_hash')
    .eq('value_hash', hash)
    .maybeSingle();
  if (error) {
    await logBackgroundFailure({ name: 'risk.blocklist', errorCode: 'READ_FAILED', message: error.message });
    return false;
  }
  return Boolean(data);
}

/** ESC-14: does any card this member has saved sit on the blocklist? */
export async function isMemberCardBlocked(profileId: string, client: AdminClient = createAdminClient()): Promise<boolean> {
  const { cardHashes } = await loadSignals(profileId, client);
  if (cardHashes.length === 0) return false;
  const { data, error } = await client
    .from('blocked_payment_fingerprints')
    .select('value_hash')
    .in('value_hash', [...cardHashes])
    .limit(1);
  if (error) {
    await logBackgroundFailure({ name: 'risk.blocklist', errorCode: 'READ_FAILED', message: error.message, context: { profileId } });
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * ESC-14: a chargeback LOST as fraud or non-receipt. Every card the paying member has
 * saved is blocked, and the member is flagged for staff. Returns how many were blocked.
 */
export async function blockMemberCards(
  profileId: string,
  disputeRef: string,
  reason: string,
  client: AdminClient = createAdminClient(),
): Promise<number> {
  const { cardHashes } = await loadSignals(profileId, client);
  if (cardHashes.length > 0) {
    const { error } = await client.from('blocked_payment_fingerprints').upsert(
      cardHashes.map((hash) => ({ value_hash: hash, reason, source_dispute_ref: disputeRef })),
      { onConflict: 'value_hash', ignoreDuplicates: true },
    );
    if (error) {
      await logBackgroundFailure({ name: 'risk.blocklist', errorCode: 'WRITE_FAILED', message: error.message, context: { profileId } });
    }
  }
  const { error: flagError } = await client
    .from('profiles')
    .update({ buyer_risk_flagged_at: new Date().toISOString() })
    .eq('id', profileId)
    .is('buyer_risk_flagged_at', null);
  if (flagError) {
    await logBackgroundFailure({ name: 'risk.blocklist', errorCode: 'WRITE_FAILED', message: flagError.message, context: { profileId } });
  }
  return cardHashes.length;
}
