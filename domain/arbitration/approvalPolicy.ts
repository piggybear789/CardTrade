// domain/arbitration/approvalPolicy.ts
//
// ESC-23: the two-person rule for staff decisions that move money.
//
// One staff account could refund a buyer, release to a seller, pay out captured
// collateral or claw back a payout on its own say-so. A compromised or colluding
// staff account was therefore a direct line to member money. Above a threshold, a
// decision is now a PROPOSAL until a second, unrelated staff member approves it.
//
// When nobody else can approve — a one-person team, or a two-person team whose other
// member is a party to the case — the proposer may approve their own proposal after a
// cooling-off period. That is weaker than two people and is recorded as such: it turns
// an instant theft into a delayed, visible one, where the alternative is a case nobody
// can ever decide.
//
// Pure: the admin actions and the tests share it.

/** Decisions at or above this value (minor units) need a second approver. */
export const TWO_PERSON_THRESHOLD_MINOR = 50_000;

/** How long a proposer nobody else can approve for waits before approving it, in hours. */
export const SOLO_COOLING_OFF_HOURS = 24;

/** The staff actions that move money, as stored on a proposal. */
export type ResolutionAction =
  | 'RESOLVE_CASH_SALE_DISPUTE'
  | 'RESOLVE_CASH_SALE_RETURN'
  | 'RESOLVE_TRACKING_FLAG'
  | 'REVERSE_CASH_SALE_PAYOUT'
  | 'RESOLVE_TRADE_DISPUTE';

/** How much money one decision moves, and toward whom. */
export interface ResolutionValue {
  action: ResolutionAction;
  /** The amount decided, in minor units. Zero when nothing moves. */
  valueMinor: number;
}

/** The value a decision is weighed at. Never negative, never fractional. */
export function valueDecidedMinor(value: ResolutionValue): number {
  return Number.isFinite(value.valueMinor) ? Math.max(0, Math.trunc(value.valueMinor)) : 0;
}

/**
 * Whether a decision needs a second approver. Fraud findings always do, whatever
 * the amount, because they also ban a member permanently.
 */
export function requiresSecondApproval(value: ResolutionValue, opts: { fraud?: boolean } = {}): boolean {
  if (opts.fraud) return true;
  return valueDecidedMinor(value) >= TWO_PERSON_THRESHOLD_MINOR;
}

/** A staff member may not decide a case they are a party to. */
export function isRecused(staffId: string, participantIds: readonly (string | null | undefined)[]): boolean {
  return participantIds.some((id) => id != null && id === staffId);
}

/** Why an approval is refused. */
export type ApprovalRefusal = 'SAME_STAFFER' | 'COOLING_OFF' | 'RECUSED' | 'NOT_PENDING';

/** Everything {@link canApprove} reads. */
export interface ApprovalFacts {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
  proposedBy: string;
  proposedAt: string;
  approverId: string;
  participantIds: readonly (string | null | undefined)[];
  /**
   * How many staff members besides the proposer could approve ({@link otherApproversFor}).
   * Zero means nobody else can, and the cooling-off rule applies.
   */
  otherApprovers: number;
  now: Date;
}

/** Staff who could approve someone else's proposal: neither its proposer nor a party to the case. */
export function otherApproversFor(
  staffIds: readonly string[],
  proposedBy: string,
  participantIds: readonly (string | null | undefined)[],
): number {
  return staffIds.filter((id) => id !== proposedBy && !isRecused(id, participantIds)).length;
}

/**
 * When the proposer may approve their own proposal, for when nobody else can. NaN for an
 * unreadable timestamp, which no clock is ever past.
 */
export function selfApprovableAt(proposedAt: string): number {
  return Date.parse(proposedAt) + SOLO_COOLING_OFF_HOURS * 3_600_000;
}

/** `null` when the approver may approve, otherwise why not. */
export function canApprove(facts: ApprovalFacts): ApprovalRefusal | null {
  if (facts.status !== 'PENDING') return 'NOT_PENDING';
  if (isRecused(facts.approverId, facts.participantIds)) return 'RECUSED';
  if (facts.approverId === facts.proposedBy) {
    if (facts.otherApprovers > 0) return 'SAME_STAFFER';
    if (!(facts.now.getTime() >= selfApprovableAt(facts.proposedAt))) return 'COOLING_OFF';
  }
  return null;
}
