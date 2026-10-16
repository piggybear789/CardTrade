// domain/risk/scamReports.ts
//
// The pure rules for off-platform scam reports (scam-reports spec). A member reports a
// scam that happened outside NoDitto; the payment details and handles the scammer used
// are stored only as HMAC fingerprints; reports that share a fingerprint form a
// cluster; and NoDitto members whose own details share one are flagged to staff.
//
// NOTHING HERE ACTS. Strength and match labels are triage for staff. The one rule that
// gates an action, `canFraudBan`, only says whether staff MAY propose a ban; the second
// approval stays with `requiresSecondApproval`.
//
// FINGERPRINTS ARE NAMESPACED APART FROM `riskSignalHash` (`v1:scam:...` vs
// `v1:<kind>:...`), so a scam fingerprint can never collide with a card or payout one.
//
// Pure: no Supabase, React or service imports.

import { createHmac } from 'node:crypto';

import { normalizeHandle, platformBySlug } from '../social/socialLinks';
import { minorUnitDigits } from '../region/regions';
import {
  REPORTABLE_IDENTIFIER_KINDS,
  SCAM_PAYMENT_METHODS,
  SCAM_REPORT_LIMITS,
  type ScamIdentifierKind,
  type ScamMatchStrength,
  type ScamPaymentMethod,
  type ScamReportStatus,
} from './scamReportVocabulary';

// The vocabulary lives in `scamReportVocabulary.ts` so the browser form can import it
// without `node:crypto`. Re-exported here so server code keeps one import path.
export * from './scamReportVocabulary';

// ---------------------------------------------------------------------------
// Normalisation, fingerprints and hints
// ---------------------------------------------------------------------------

/** One identifier as entered or derived. `platform` only for HANDLE. */
export interface RawIdentifier {
  kind: ScamIdentifierKind;
  value: string;
  platform?: string | null;
}

/** One identifier after normalisation, ready to hash. */
export interface NormalisedIdentifier {
  kind: ScamIdentifierKind;
  value: string;
  platform: string | null;
}

function normaliseEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/**
 * Digits only, Australian mobiles and landlines to `+61…`. A number already in
 * international form keeps its country code. Too short to be a phone: null.
 */
export function normalisePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const international = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.slice(2);
  if (!international) {
    if (digits.startsWith('61')) {
      // Already 61-prefixed without a plus.
    } else if (digits.startsWith('0')) {
      digits = `61${digits.slice(1)}`;
    } else {
      digits = `61${digits}`;
    }
  }
  return digits.length >= 9 && digits.length <= 15 ? `+${digits}` : null;
}

/** BSB (6 digits) plus account (4–10 digits), separators removed: `062000:12345678`. */
export function normaliseBankAccount(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 16) return null;
  return `${digits.slice(0, 6)}:${digits.slice(6)}`;
}

/** The partial-bank form of a full bank account: BSB plus last 4. */
export function bankPartialOf(normalisedBank: string): string {
  const [bsb, account] = normalisedBank.split(':');
  return `${bsb}:${account.slice(-4)}`;
}

/**
 * Normalise one identifier, or null when it is not a value of that kind. Formatting
 * differences (case, spaces, dashes, a leading @) must not stop two reports matching.
 */
export function normaliseIdentifier(raw: RawIdentifier): NormalisedIdentifier | null {
  const value = typeof raw.value === 'string' ? raw.value : '';
  switch (raw.kind) {
    case 'PAYID_EMAIL':
    case 'PAYPAL_EMAIL': {
      const email = normaliseEmail(value);
      return email ? { kind: raw.kind, value: email, platform: null } : null;
    }
    case 'PAYID_PHONE':
    case 'PHONE': {
      const phone = normalisePhone(value);
      return phone ? { kind: raw.kind, value: phone, platform: null } : null;
    }
    case 'BANK_ACCOUNT': {
      const bank = normaliseBankAccount(value);
      return bank ? { kind: 'BANK_ACCOUNT', value: bank, platform: null } : null;
    }
    case 'BANK_PARTIAL': {
      const digits = value.replace(/\D/g, '');
      return digits.length === 10
        ? { kind: 'BANK_PARTIAL', value: `${digits.slice(0, 6)}:${digits.slice(6)}`, platform: null }
        : null;
    }
    case 'CRYPTO_WALLET': {
      const trimmed = value.trim();
      if (trimmed.length < 20 || trimmed.length > 120 || /\s/.test(trimmed)) return null;
      return {
        kind: 'CRYPTO_WALLET',
        value: /^0x/i.test(trimmed) ? trimmed.toLowerCase() : trimmed,
        platform: null,
      };
    }
    case 'HANDLE': {
      const platform = platformBySlug(String(raw.platform ?? ''));
      if (!platform || platform.kind !== 'handle') return null;
      const handle = normalizeHandle(value).toLowerCase();
      if (!handle || handle.length > 100 || /[\s/:]/.test(handle)) return null;
      return { kind: 'HANDLE', value: handle, platform: platform.slug };
    }
    default:
      return null;
  }
}

/**
 * Every identifier a normalised one implies: a full bank account also yields its
 * partial form, so a report can meet a member whose payout BSB and last 4 match.
 */
export function expandIdentifier(identifier: NormalisedIdentifier): NormalisedIdentifier[] {
  if (identifier.kind !== 'BANK_ACCOUNT') return [identifier];
  return [identifier, { kind: 'BANK_PARTIAL', value: bankPartialOf(identifier.value), platform: null }];
}

/** HMAC of a normalised identifier. Null without a secret: no fingerprint beats a guessable one. */
export function identifierHash(identifier: NormalisedIdentifier, secret: string): string | null {
  const key = secret.trim();
  if (!key) return null;
  const material = `v1:scam:${identifier.kind}:${identifier.platform ?? ''}:${identifier.value}`;
  return createHmac('sha256', key).update(material, 'utf8').digest('hex');
}

function maskMiddle(value: string, keepStart: number, keepEnd: number): string {
  if (value.length <= keepStart + keepEnd) return '•'.repeat(Math.max(value.length, 3));
  return `${value.slice(0, keepStart)}${'•'.repeat(3)}${value.slice(value.length - keepEnd)}`;
}

/** A hint staff can read without seeing the value. */
export function maskIdentifier(identifier: NormalisedIdentifier): string {
  const { kind, value, platform } = identifier;
  switch (kind) {
    case 'PAYID_EMAIL':
    case 'PAYPAL_EMAIL': {
      const [local, domain] = value.split('@');
      const label = kind === 'PAYID_EMAIL' ? 'PayID' : 'PayPal';
      return `${label} ${local.slice(0, 1)}•••@${domain}`;
    }
    case 'PAYID_PHONE':
    case 'PHONE':
      return `${kind === 'PAYID_PHONE' ? 'PayID' : 'Phone'} ${maskMiddle(value, 4, 3)}`;
    case 'BANK_ACCOUNT': {
      const [bsb, account] = value.split(':');
      return `BSB ${bsb.slice(0, 3)}-••• acct ••••${account.slice(-4)}`;
    }
    case 'BANK_PARTIAL': {
      const [bsb, last4] = value.split(':');
      return `BSB ${bsb.slice(0, 3)}-••• acct ••••${last4}`;
    }
    case 'CRYPTO_WALLET':
      return `Wallet ${maskMiddle(value, 6, 4)}`;
    case 'HANDLE': {
      const label = platformBySlug(platform ?? '')?.label ?? 'Handle';
      return `${label} @${maskMiddle(value, 3, 2)}`;
    }
    default:
      return '•••';
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ScamReportInput {
  narrative: string;
  /** `YYYY-MM`. */
  occurredMonth: string;
  paymentMethod: string;
  /** Major-unit string as typed, e.g. "250" or "250.50". Optional. */
  amount: string;
  currency: string;
  identifiers: { kind: string; value: string; platform?: string | null }[];
  scammerName: string;
  evidencePaths: string[];
  declared: boolean;
}

export interface ValidScamReport {
  narrative: string;
  /** First of the month, ISO date. */
  occurredMonth: string;
  paymentMethod: ScamPaymentMethod;
  amountMinor: number | null;
  currency: string | null;
  identifiers: NormalisedIdentifier[];
  scammerName: string | null;
  evidencePaths: string[];
}

export type ScamReportValidation =
  | { ok: true; value: ValidScamReport }
  | { ok: false; field: string; message: string };

const REPORTABLE = new Set<string>(REPORTABLE_IDENTIFIER_KINDS.map((option) => option.kind));

/**
 * Validate a report. `ownerPrefix` is `<reporterId>/`: an evidence path outside it is
 * not this reporter's upload. `now` bounds the month so a report cannot be dated in
 * the future.
 */
export function validateScamReport(
  input: ScamReportInput,
  ownerPrefix: string,
  now: Date,
): ScamReportValidation {
  const fail = (field: string, message: string): ScamReportValidation => ({ ok: false, field, message });

  const narrative = typeof input?.narrative === 'string' ? input.narrative.trim() : '';
  if (narrative.length < SCAM_REPORT_LIMITS.narrativeMin) {
    return fail('narrative', 'Tell us what happened in a bit more detail.');
  }
  if (narrative.length > SCAM_REPORT_LIMITS.narrativeMax) {
    return fail('narrative', `Keep it under ${SCAM_REPORT_LIMITS.narrativeMax.toLocaleString('en-AU')} characters.`);
  }

  const month = /^(\d{4})-(\d{2})$/.exec(String(input?.occurredMonth ?? ''));
  if (!month) return fail('occurredMonth', 'Choose roughly when it happened.');
  const year = Number(month[1]);
  const monthIndex = Number(month[2]) - 1;
  const occurred = new Date(Date.UTC(year, monthIndex, 1));
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (monthIndex < 0 || monthIndex > 11 || occurred > thisMonth || year < 2000) {
    return fail('occurredMonth', 'Choose a month that has already happened.');
  }

  const method = SCAM_PAYMENT_METHODS.find((option) => option.value === input?.paymentMethod);
  if (!method) return fail('paymentMethod', 'Tell us how you paid.');

  let amountMinor: number | null = null;
  let currency: string | null = null;
  const amountText = typeof input?.amount === 'string' ? input.amount.trim() : '';
  if (amountText) {
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(amountText)) {
      return fail('amount', 'Enter an amount like 250 or 250.50.');
    }
    currency = /^[a-z]{3}$/i.test(String(input?.currency ?? '')) ? String(input.currency).toLowerCase() : 'aud';
    // The divisor is the currency's own (0 digits for JPY), never an assumed 100.
    let digits: number;
    try {
      digits = minorUnitDigits(currency);
    } catch {
      return fail('amount', 'Enter an amount like 250 or 250.50.');
    }
    const [whole, fraction = ''] = amountText.split('.');
    if (fraction.length > digits) return fail('amount', 'Enter an amount like 250 or 250.50.');
    amountMinor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
    if (amountMinor <= 0) return fail('amount', 'Enter an amount above zero, or leave it blank.');
  }

  const rows = Array.isArray(input?.identifiers) ? input.identifiers : [];
  const identifiers: NormalisedIdentifier[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (typeof row?.value !== 'string' || !row.value.trim()) continue;
    if (!REPORTABLE.has(String(row.kind))) return fail(`identifiers.${index}`, 'Choose what kind of detail this is.');
    const normalised = normaliseIdentifier({
      kind: row.kind as ScamIdentifierKind,
      value: row.value,
      platform: row.platform ?? null,
    });
    if (!normalised) {
      return fail(
        `identifiers.${index}`,
        row.kind === 'HANDLE'
          ? 'Choose the platform and enter their username without the link.'
          : 'That doesn’t look right. Check it and try again.',
      );
    }
    const key = `${normalised.kind}:${normalised.platform ?? ''}:${normalised.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    identifiers.push(normalised);
  }
  if (identifiers.length === 0) {
    return fail('identifiers', 'Add at least one payment detail or handle they used.');
  }
  if (identifiers.length > SCAM_REPORT_LIMITS.identifiersMax) {
    return fail('identifiers', `Add up to ${SCAM_REPORT_LIMITS.identifiersMax} details.`);
  }

  const scammerName = typeof input?.scammerName === 'string' ? input.scammerName.trim() : '';
  if (scammerName.length > SCAM_REPORT_LIMITS.scammerNameMax) {
    return fail('scammerName', 'Keep the name short.');
  }

  const evidencePaths = [...new Set(Array.isArray(input?.evidencePaths) ? input.evidencePaths : [])].filter(
    (path): path is string => typeof path === 'string' && path.length > 0,
  );
  if (evidencePaths.length < SCAM_REPORT_LIMITS.evidenceMin) {
    return fail('evidence', 'Add at least one screenshot or photo.');
  }
  if (evidencePaths.length > SCAM_REPORT_LIMITS.evidenceMax) {
    return fail('evidence', `Add up to ${SCAM_REPORT_LIMITS.evidenceMax} photos.`);
  }
  if (evidencePaths.some((path) => !path.startsWith(ownerPrefix) || path.includes('..'))) {
    return fail('evidence', 'One of those photos could not be attached.');
  }

  if (input?.declared !== true) {
    return fail('declared', 'Confirm the report is true to the best of your knowledge.');
  }

  return {
    ok: true,
    value: {
      narrative,
      occurredMonth: occurred.toISOString().slice(0, 10),
      paymentMethod: method.value,
      amountMinor,
      currency,
      identifiers,
      scammerName: scammerName || null,
      evidencePaths,
    },
  };
}

// ---------------------------------------------------------------------------
// Corroboration and match strength
// ---------------------------------------------------------------------------

/** One report as the strength rule reads it. */
export interface ClusterReport {
  reportId: string;
  reporterId: string | null;
  status: ScamReportStatus;
  /** Kinds of the fingerprints this report shares with the cluster. */
  sharedKinds: readonly ScamIdentifierKind[];
}

/**
 * Independent-reporter count for a cluster (Req 4).
 *
 * Dismissed and withdrawn reports do not count. Reporters related to each other
 * (`related(a, b)`, from `areRelated`) count once between them. A reporter whose only
 * link to the cluster is a handle counts half, because handles are what scammers
 * impersonate.
 */
export function clusterStrength(
  reports: readonly ClusterReport[],
  related: (a: string, b: string) => boolean,
): number {
  const live = reports.filter(
    (report) => report.status !== 'DISMISSED' && report.status !== 'WITHDRAWN' && report.reporterId,
  );
  // One weight per reporter: their strongest link.
  const weightByReporter = new Map<string, number>();
  for (const report of live) {
    const weight = report.sharedKinds.some((kind) => kind !== 'HANDLE') ? 1 : 0.5;
    const id = report.reporterId as string;
    weightByReporter.set(id, Math.max(weightByReporter.get(id) ?? 0, weight));
  }
  // Group related reporters; each group contributes its strongest member once.
  const reporters = [...weightByReporter.keys()];
  const groupOf = new Map<string, number>();
  let groups = 0;
  for (const reporter of reporters) {
    const existing = [...groupOf.entries()].find(([other]) => related(reporter, other));
    groupOf.set(reporter, existing ? existing[1] : groups++);
  }
  const groupWeight = new Map<number, number>();
  for (const [reporter, group] of groupOf) {
    groupWeight.set(group, Math.max(groupWeight.get(group) ?? 0, weightByReporter.get(reporter) ?? 0));
  }
  return [...groupWeight.values()].reduce((sum, weight) => sum + weight, 0);
}

/** "Corroborated" once at least two independent reporters stand behind it. */
export const CORROBORATION_THRESHOLD = 2;

export function isCorroborated(strength: number): boolean {
  return strength >= CORROBORATION_THRESHOLD;
}

/** How strongly a member matched a report, from the kinds that matched (Req 6.4). */
export function matchStrength(kinds: readonly ScamIdentifierKind[]): ScamMatchStrength {
  if (kinds.some((kind) => kind !== 'HANDLE' && kind !== 'BANK_PARTIAL')) return 'STRONG';
  if (kinds.includes('BANK_PARTIAL')) return 'MEDIUM';
  return 'WEAK';
}

/**
 * Whether staff MAY propose a fraud ban on off-platform reports alone (Req 7.3). The
 * second approval is still required on top, through `requiresSecondApproval`.
 */
export function canFraudBan(p: {
  clusterStrength: number;
  matchStrength: ScamMatchStrength;
  notifiedAt: string | null;
  respondedAt: string | null;
  responseDueAt: string | null;
  now: Date;
}): { ok: true } | { ok: false; reason: string } {
  if (!isCorroborated(p.clusterStrength)) {
    return { ok: false, reason: 'Needs reports from at least two independent members.' };
  }
  if (p.matchStrength === 'WEAK') {
    return { ok: false, reason: 'A handle-only match is never enough to ban.' };
  }
  if (!p.notifiedAt) {
    return { ok: false, reason: 'Tell the member first and give them time to respond.' };
  }
  const due = p.responseDueAt ? Date.parse(p.responseDueAt) : NaN;
  if (!p.respondedAt && !(Number.isFinite(due) && due <= p.now.getTime())) {
    return { ok: false, reason: 'Their response window has not closed yet.' };
  }
  return { ok: true };
}
