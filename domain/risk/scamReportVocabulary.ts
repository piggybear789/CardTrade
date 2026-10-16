// domain/risk/scamReportVocabulary.ts
//
// The vocabulary of off-platform scam reports (scam-reports spec): identifier kinds,
// payment methods, statuses and limits.
//
// SPLIT FROM `scamReports.ts` so the browser form can import it. That module pulls in
// `node:crypto` for the fingerprints, which a client bundle cannot load. Nothing here
// computes anything; `scamReports.ts` re-exports all of it, so server code keeps one
// import path.
//
// Pure: no imports at all.

export const SCAM_IDENTIFIER_KINDS = [
  'PAYID_EMAIL',
  'PAYID_PHONE',
  'BANK_ACCOUNT',
  'BANK_PARTIAL',
  'PAYPAL_EMAIL',
  'CRYPTO_WALLET',
  'PHONE',
  'HANDLE',
] as const;
export type ScamIdentifierKind = (typeof SCAM_IDENTIFIER_KINDS)[number];

/** Kinds a reporter types. `BANK_PARTIAL` is derived, never entered. */
export const REPORTABLE_IDENTIFIER_KINDS = [
  { kind: 'PAYID_EMAIL', label: 'PayID (email)' },
  { kind: 'PAYID_PHONE', label: 'PayID (phone)' },
  { kind: 'BANK_ACCOUNT', label: 'Bank account (BSB and account)' },
  { kind: 'PAYPAL_EMAIL', label: 'PayPal email' },
  { kind: 'CRYPTO_WALLET', label: 'Crypto wallet' },
  { kind: 'PHONE', label: 'Phone number' },
  { kind: 'HANDLE', label: 'Social handle' },
] as const satisfies readonly { kind: ScamIdentifierKind; label: string }[];
export type ReportableIdentifierKind = (typeof REPORTABLE_IDENTIFIER_KINDS)[number]['kind'];

/** Staff-facing label for every kind, including the derived one. */
export const SCAM_IDENTIFIER_KIND_LABEL: Record<ScamIdentifierKind, string> = {
  PAYID_EMAIL: 'PayID email',
  PAYID_PHONE: 'PayID phone',
  BANK_ACCOUNT: 'Bank account',
  BANK_PARTIAL: 'BSB + last 4',
  PAYPAL_EMAIL: 'PayPal email',
  CRYPTO_WALLET: 'Crypto wallet',
  PHONE: 'Phone',
  HANDLE: 'Handle',
};

export const SCAM_PAYMENT_METHODS = [
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'PAYID', label: 'PayID' },
  { value: 'PAYPAL_FF', label: 'PayPal Friends and Family' },
  { value: 'PAYPAL_GS', label: 'PayPal Goods and Services' },
  { value: 'CRYPTO', label: 'Crypto' },
  { value: 'GIFT_CARD', label: 'Gift card' },
  { value: 'CASH', label: 'Cash' },
  { value: 'OTHER', label: 'Something else' },
] as const;
export type ScamPaymentMethod = (typeof SCAM_PAYMENT_METHODS)[number]['value'];

export type ScamReportStatus = 'SUBMITTED' | 'REVIEWED' | 'CORROBORATED' | 'DISMISSED' | 'WITHDRAWN';
export type ScamMatchStrength = 'STRONG' | 'MEDIUM' | 'WEAK';
/** A dismissed match is deleted rather than kept, so it has no status. */
export type ScamMatchStatus = 'OPEN' | 'CONFIRMED';

/** Mirrors the CHECKs in 0154. */
export const SCAM_REPORT_LIMITS = {
  narrativeMin: 50,
  narrativeMax: 4000,
  identifiersMax: 10,
  evidenceMin: 1,
  evidenceMax: 10,
  scammerNameMax: 120,
  reportsPerWindow: 3,
  windowDays: 30,
  responseDays: 14,
  deleteDismissedAfterDays: 90,
} as const;

/**
 * What the REPORTER sees for their own report. Deliberately coarse: "Reviewed" covers
 * corroborated too, because telling a reporter that others reported the same person
 * would confirm a match exists.
 */
export function reporterFacingStatus(status: ScamReportStatus): string {
  switch (status) {
    case 'SUBMITTED':
      return 'Received';
    case 'REVIEWED':
    case 'CORROBORATED':
      return 'Reviewed';
    case 'DISMISSED':
      return 'Closed';
    case 'WITHDRAWN':
      return 'Withdrawn';
  }
}
