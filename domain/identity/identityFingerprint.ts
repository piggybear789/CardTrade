// domain/identity/identityFingerprint.ts
//
// Person-level keys for the Identity ban list. A Profile ban only locks one
// login; these hashes let a later account that verifies as the SAME government
// identity be refused before `identity_check_status` becomes VERIFIED.
//
// THE RAW ID NUMBER, NAME AND DOB NEVER LEAVE THIS FUNCTION. Callers persist
// only the HMAC hex. Rotating the secret orphans existing hashes, so the secret
// is a dedicated `IDENTITY_FINGERPRINT_SECRET`, not a key that rotates with
// Stripe credentials.

import { createHmac } from 'node:crypto';

export type IdentityFingerprintKind = 'document-id' | 'name-dob';

export interface IdentityFingerprint {
  kind: IdentityFingerprintKind;
  /** HMAC-SHA256 hex. Not reversible. Safe to persist; never a client field. */
  hash: string;
}

/** Provider-verified fields used to build hashes. Discard after hashing. */
export interface IdentityFingerprintSource {
  idNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dob?: { day: number; month: number; year: number } | null;
  /**
   * The document's ISSUING country (ESC-15). Scopes the document key, because two
   * countries can issue the same number. Never the address country: moving house
   * must not make a banned person a new person.
   */
  issuingCountry?: string | null;
  /** @deprecated ignored since ESC-15; the address country never keys a person. */
  country?: string | null;
}

/**
 * One or two person keys from a verified Identity session.
 *
 * Prefers the government ID number (`document-id`). Also emits `name-dob` when
 * both a name and a date of birth are present, so a banned person cannot skip
 * the list by verifying with a different document. Returns nothing when the
 * secret is missing or the session has no usable fields — account-only bans
 * still apply, person-matching does not.
 */
export function identityFingerprints(
  source: IdentityFingerprintSource,
  secret: string,
): IdentityFingerprint[] {
  const key = secret.trim();
  if (!key) return [];

  const out: IdentityFingerprint[] = [];

  // `doc:<issuingCountry>:<number>` (ESC-15). Stored under the existing
  // `document-id` kind (0105), so no constraint changes.
  const idNumber = normalizeIdNumber(source.idNumber);
  if (idNumber) {
    out.push({
      kind: 'document-id',
      hash: hmac(key, `doc:${normalizeCountry(source.issuingCountry)}:${idNumber}`),
    });
  }

  // `namedob:<family>:<firstGiven>:<yyyy-mm-dd>`. The FIRST given name only, so a
  // passport ("Mary Jane") and a licence ("Mary") for one person share the key, and
  // no country at all, so a second document from another country still matches.
  const family = normalizePart(source.lastName);
  const firstGiven = normalizePart(source.firstName)?.split(' ')[0] ?? null;
  const dob = formatDob(source.dob);
  if (family && firstGiven && dob) {
    out.push({
      kind: 'name-dob',
      hash: hmac(key, `namedob:${family}:${firstGiven}:${dob}`),
    });
  }

  return out;
}

function normalizePart(value: string | null | undefined): string | null {
  const part =
    value
      ?.normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/[\s-]+/g, ' ')
      .toLowerCase() ?? '';
  return part.length > 0 ? part : null;
}

function hmac(secret: string, material: string): string {
  return createHmac('sha256', secret).update(material, 'utf8').digest('hex');
}

function normalizeIdNumber(value: string | null | undefined): string | null {
  const compact = value?.replace(/[\s.\-]/g, '').toUpperCase() ?? '';
  return compact.length > 0 ? compact : null;
}

function normalizeCountry(value: string | null | undefined): string {
  const code = value?.trim().toUpperCase() ?? '';
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

function formatDob(
  dob: { day: number; month: number; year: number } | null | undefined,
): string | null {
  if (!dob || !dob.day || !dob.month || !dob.year) return null;
  const year = String(dob.year).padStart(4, '0');
  const month = String(dob.month).padStart(2, '0');
  const day = String(dob.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
