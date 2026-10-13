// domain/identity/payeeNameMatch.ts
//
// Whether the name on a seller's payout account is the person whose ID was verified
// (ESC-25). Pure.
//
// Stripe Identity checks a government document; Connect payout onboarding collects a
// bank account and a name, and nothing tied the two together. So one person could
// verify and then route payouts to someone else's account: the disclosed seller and
// the person paid could differ. A mismatch now stops payouts (`canReceiveFunds`)
// until it is fixed or staff clear a legitimate short form (Robert vs Bob).

import { createHmac } from 'node:crypto';

export interface NameParts {
  given: string;
  family: string;
}

/** Lower-case, strip diacritics and punctuation, collapse spaces and hyphens. */
export function normalizeNamePart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[\s-]+/g, ' ')
    .trim();
}

/**
 * Same family name, and the payee's first given name is a prefix-match of the
 * identity's first given name (or the other way round), so "Mary Jane" and "Mary"
 * match. A nickname ("Bob" for "Robert") does not; staff clear those.
 */
export function namesMatch(identity: NameParts, payee: NameParts): boolean {
  const idFamily = normalizeNamePart(identity.family);
  const payFamily = normalizeNamePart(payee.family);
  if (!idFamily || idFamily !== payFamily) return false;
  const idFirst = normalizeNamePart(identity.given).split(' ')[0] ?? '';
  const payFirst = normalizeNamePart(payee.given).split(' ')[0] ?? '';
  if (!idFirst || !payFirst) return false;
  return idFirst.startsWith(payFirst) || payFirst.startsWith(idFirst);
}

/** HMAC of a normalised (identity, payee) pair: what a staff clearance records. */
export function payeePairHash(identity: NameParts, payee: NameParts, secret: string): string | null {
  const key = secret.trim();
  if (!key) return null;
  const material = [identity.given, identity.family, payee.given, payee.family].map(normalizeNamePart).join('|');
  return createHmac('sha256', key).update(`v1:payee:${material}`, 'utf8').digest('hex');
}

export type PayeeMatchDecision =
  /** Names agree: clear any mismatch flag. */
  | 'MATCH'
  /** Names disagree: set the flag; payouts stop. */
  | 'MISMATCH'
  /** A grandfathered member with no document name: nothing to compare. */
  | 'SKIP_NO_IDENTITY_NAME'
  /** The provider did not expose the payee name: log once, never flag. */
  | 'UNAVAILABLE'
  /** Staff cleared exactly this pair: keep it cleared. */
  | 'CLEARED';

export function decidePayeeMatch(params: {
  identityName: NameParts | null;
  payeeName: NameParts | null;
  /** The pair hash staff cleared, if any. */
  clearedPair: string | null;
  secret: string;
}): PayeeMatchDecision {
  if (!params.identityName) return 'SKIP_NO_IDENTITY_NAME';
  if (!params.payeeName) return 'UNAVAILABLE';
  if (namesMatch(params.identityName, params.payeeName)) return 'MATCH';
  const pair = payeePairHash(params.identityName, params.payeeName, params.secret);
  if (pair && params.clearedPair && pair === params.clearedPair) return 'CLEARED';
  return 'MISMATCH';
}

/** Split a full verified name into given / family (last word is the family name). */
export function splitFullName(full: string | null | undefined): NameParts | null {
  const words = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  return { given: words.slice(0, -1).join(' '), family: words[words.length - 1]! };
}
