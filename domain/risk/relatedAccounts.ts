// domain/risk/relatedAccounts.ts
//
// Whether two members are, on the evidence we hold, the same person or one household
// (ESC-03 layer 3). Pure.
//
// The stolen-card cash-out needs a buyer account and a seller account under one
// person's control: buy from yourself with someone else's card, get paid out before
// the chargeback lands. Each account looks clean on its own. What gives them away is
// what they share: the same physical card (provider card fingerprint), the same
// payout bank account, or the same verified person (an identity person key).
//
// Every value here is an HMAC, never the raw fingerprint or document number, and the
// refusal copy never says which signal matched.

import { createHmac } from 'node:crypto';

export type RiskSignalKind = 'CARD_FINGERPRINT' | 'PAYOUT_ACCOUNT_FINGERPRINT';

/** What one member's account carries. Values are opaque hashes. */
export interface SignalSet {
  cardHashes: readonly string[];
  payoutHashes: readonly string[];
  /** `identity_person_keys.hash` for the member. */
  personKeys: readonly string[];
}

export const EMPTY_SIGNALS: SignalSet = { cardHashes: [], payoutHashes: [], personKeys: [] };

/**
 * The HMAC stored for a raw provider fingerprint. Kind-scoped so a card hash can never
 * collide with a bank-account hash. Null without a secret: no signal is better than a
 * guessable one.
 */
export function riskSignalHash(kind: RiskSignalKind, raw: string, secret: string): string | null {
  const key = secret.trim();
  const value = raw.trim();
  if (!key || !value) return null;
  return createHmac('sha256', key).update(`v1:${kind}:${value}`, 'utf8').digest('hex');
}

function overlaps(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((value) => set.has(value));
}

/** True when the two members share a card, a payout account, or a verified person. */
export function areRelated(a: SignalSet, b: SignalSet): boolean {
  return (
    overlaps(a.cardHashes, b.cardHashes) ||
    overlaps(a.payoutHashes, b.payoutHashes) ||
    overlaps(a.personKeys, b.personKeys)
  );
}

/** Member-facing refusal. Deliberately never says why. */
export const RELATED_ACCOUNTS_MESSAGE =
  "This deal can't go ahead. Contact support if you think this is a mistake.";
