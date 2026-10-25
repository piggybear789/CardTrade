// lib/legal/operator.ts
//
// Who operates NoDitto, for the Terms and the Privacy policy. ONE place, so the two
// documents can never name different entities or contact points.
//
// NoDitto is a business of Studitory Pty Ltd, the contracting entity (name and ABN as
// registered on the Australian Business Register). Still to confirm before relying on
// them: the address, the governing law and the two mailboxes, which have to exist and be
// read. `reviewedByCounsel` stays false until a lawyer has signed the documents off;
// `showDraftNotice` decides whether the pages say so.

export const LEGAL = {
  /** The contracting entity that operates NoDitto. */
  operatorName: 'Studitory Pty Ltd',
  /** Australian Business Number, shown when set. */
  abn: '21 684 300 847' as string | null,
  /** Registered or postal address, shown when set. */
  address: null as string | null,
  /** The state whose law governs the Terms. Confirm with counsel. */
  governingLaw: 'New South Wales, Australia',
  /** Where members raise support, disputes and complaints. Must be a monitored inbox. */
  supportEmail: 'support@noditto.app',
  /** Where privacy requests go. Must be a monitored inbox. */
  privacyEmail: 'privacy@noditto.app',
  /** When this version of both documents took effect. */
  effectiveDate: '22 October 2026',
  /** Flip to true once a lawyer has reviewed both documents. */
  reviewedByCounsel: false,
  /**
   * Whether both pages show the "Draft" notice. Turned off by product decision
   * (2026-10-21) for launch, separately from `reviewedByCounsel`, which stays an honest
   * record that no lawyer has reviewed the documents yet.
   */
  showDraftNotice: false,
} as const;

/** "Studitory Pty Ltd (ABN 21 684 300 847)", or just the name while the ABN is unset. */
export function operatorIdentity(): string {
  return LEGAL.abn ? `${LEGAL.operatorName} (ABN ${LEGAL.abn})` : LEGAL.operatorName;
}
