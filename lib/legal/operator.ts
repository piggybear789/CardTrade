// lib/legal/operator.ts
//
// Who operates NoDitto, for the Terms and the Privacy policy. ONE place, so the two
// documents can never name different entities or contact points.
//
// CONFIRM EVERY VALUE BEFORE LAUNCH. These are drafting placeholders: the legal entity,
// its ABN and address, the governing law and the two mailboxes have to be the real
// ones, and the mailboxes have to exist and be read. `reviewedByCounsel` stays false
// until a lawyer has signed the documents off; `showDraftNotice` decides whether the
// pages say so.

export const LEGAL = {
  /** The contracting entity, e.g. "NoDitto Pty Ltd". The brand until confirmed. */
  operatorName: 'NoDitto',
  /** Australian Business Number, shown when set. */
  abn: null as string | null,
  /** Registered or postal address, shown when set. */
  address: null as string | null,
  /** The state whose law governs the Terms. Confirm with counsel. */
  governingLaw: 'New South Wales, Australia',
  /** Where members raise support, disputes and complaints. Must be a monitored inbox. */
  supportEmail: 'support@noditto.app',
  /** Where privacy requests go. Must be a monitored inbox. */
  privacyEmail: 'privacy@noditto.app',
  /** When this version of both documents took effect. */
  effectiveDate: '21 October 2026',
  /** Flip to true once a lawyer has reviewed both documents. */
  reviewedByCounsel: false,
  /**
   * Whether both pages show the "Draft" notice. Turned off by product decision
   * (2026-10-21) for launch, separately from `reviewedByCounsel`, which stays an honest
   * record that no lawyer has reviewed the documents yet.
   */
  showDraftNotice: false,
} as const;

/** "NoDitto (ABN 12 345 678 901)", or just the name while the ABN is unset. */
export function operatorIdentity(): string {
  return LEGAL.abn ? `${LEGAL.operatorName} (ABN ${LEGAL.abn})` : LEGAL.operatorName;
}
