// domain/contract/dealSteps.ts
//
// The private deal action plan. Replaces the ad-hoc `steps` array the deal room
// built inline, so a deal's progress is derived by the same pure, testable
// mechanism as a cash sale's and a trade's.
//
// A deal is created SOLO and shared as a link, so its first step is "somebody
// joins" — the only contract flow that starts with an empty seat. Collateral is
// SYMMETRIC and conditional: two verified parties are bound by identity and post
// nothing, otherwise both post the deal's stake.

import {
  sequenceHaltedSteps,
  sequenceSteps,
  type ContractStep,
  type ContractStepDraft,
} from './steps';

/** The `deal_state` values, mirrored here so the domain stays free of DB types. */
export type DealStepState =
  | 'INVITED'
  | 'TERMS'
  | 'CONFIRMATION'
  | 'ESCROW_PENDING'
  | 'ESCROW_LOCKED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DISPUTED';

/** Section ids the deal plan's `focus` actions point at. */
export const DEAL_SECTIONS = {
  summary: 'contract-summary',
  items: 'contract-items',
  /**
   * Who is on the other side: the commitment-point Identity_Disclosure and their
   * trading history. Matches `CASH_SALE_SECTIONS.parties`.
   *
   * The disclosure used to sit in the action card, where it occupied the top of the
   * "what do I do now" region for the whole life of the deal — including after
   * completion — with a fact that never changes. It is reference material, so it
   * belongs in the inspector. It must stay SOMEWHERE in the room: Requirement 12
   * (`.kiro/specs/cardtrade/requirements.md`) requires the counterparty's legal name
   * and verification date at a Commitment_Point, and a Deal is one. A private deal
   * is invite-by-token with no connected account, so this room is the only place a
   * joiner learns who they are locking money with.
   */
  parties: 'contract-parties',
  terms: 'contract-terms',
  money: 'contract-money',
  collateral: 'contract-collateral',
  share: 'contract-share',
} as const;

/** Everything the deal plan needs, derived from the live deal row + view. */
export interface DealStepFacts {
  state: DealStepState;
  /** False until somebody opens the share link. */
  joined: boolean;
  /** The other party's name, or `null` while the seat is open. */
  counterpartyName: string | null;
  /** Both sides have supplied item text + evidence photos where required. */
  contributionsComplete: boolean;
  /** The handover method and its mandatory details are set. */
  termsComplete: boolean;
  myConfirmed: boolean;
  theirConfirmed: boolean;
  /** True when either party is unverified, so both post collateral. */
  collateralRequired: boolean;
  /** Handover completion marks, once the contract is binding. */
  iMarkedComplete: boolean;
  theyMarkedComplete: boolean;
  /**
   * For a CANCELLED deal: the state it was in before it closed. Makes "cancelled
   * at Locked" exact rather than guessed — once `state` is CANCELLED it no longer
   * reports progress.
   */
  haltedAt?: DealStepState | null;
  /**
   * `deals.dispute_outcome`, when the deal was closed by arbitration.
   *
   * Load-bearing for the halt copy, not decoration. A pre-binding cancellation and
   * an arbitrated unwind BOTH land in CANCELLED — that is deliberate, and there is
   * no `RESOLVED` state to tell them apart (see `.kiro/steering/product.md`). So
   * without this the room would tell a member "nothing was charged" after a SPLIT,
   * which captured part of the cash. Collateral is released in every outcome.
   */
  disputeOutcome?: 'REFUND_PAYER' | 'SPLIT' | 'RELEASE_RECIPIENT' | null;
}

/** States where the contract is binding — collateral placed or identity-bound. */
const ENGAGED: ReadonlySet<DealStepState> = new Set<DealStepState>([
  'ESCROW_PENDING',
  'ESCROW_LOCKED',
  'COMPLETED',
  'DISPUTED',
]);

/** Build the ordered action plan for a private deal. */
export function deriveDealSteps(facts: DealStepFacts): ContractStep[] {
  const {
    joined,
    counterpartyName,
    contributionsComplete,
    termsComplete,
    myConfirmed,
    theirConfirmed,
    collateralRequired,
    iMarkedComplete,
    theyMarkedComplete,
  } = facts;

  const them = counterpartyName ?? 'the other party';

  const cancelled = facts.state === 'CANCELLED';

  // Reason about PROGRESS with the halt point once the deal is closed: its own state
  // stops reporting how far it got. Most deal steps key off surviving booleans, so
  // only `engage` actually depends on this.
  const state: DealStepState = cancelled
    ? (facts.haltedAt ?? 'TERMS')
    : facts.state;

  const drafts: ContractStepDraft[] = [
    {
      id: 'join',
      short: 'Join',
      label: joined
        ? 'The other party joined'
        : 'Waiting for the other party to join',
      detail: joined
        ? `${them} took the seat.`
        : 'Send your share link to the person you mean to deal with. The first person to open it takes the seat.',
      owner: joined ? 'both' : 'you',
      done: joined,
      action: joined
        ? undefined
        : { label: 'Share the link', kind: 'focus', target: DEAL_SECTIONS.share },
    },
    {
      id: 'document',
      // Six ticks in this rail: 'Evidence' truncated on mobile.
      short: 'Items',
      label: 'Both sides document what they bring',
      detail: contributionsComplete
        ? 'Item details and evidence photos are on the record for both sides.'
        : 'Each person adds their own item details and evidence photos. These become part of the deal record.',
      owner: 'both',
      done: contributionsComplete,
      action: contributionsComplete
        ? undefined
        : { label: 'Add your side', kind: 'focus', target: DEAL_SECTIONS.items },
    },
    {
      id: 'terms',
      short: 'Terms',
      label: 'Set the handover',
      detail: termsComplete
        ? 'Handover method and details are set.'
        : 'Choose a face-to-face meeting or a delivery, and fill in the details.',
      owner: 'both',
      done: termsComplete,
      action: termsComplete
        ? undefined
        : { label: 'Set terms', kind: 'focus', target: DEAL_SECTIONS.terms },
    },
    {
      id: 'confirm',
      // Rail shorts must survive a six-tick rail on a 360px screen (~6
      // characters); 'Confirm' and 'Binding' truncated on mobile.
      short: 'Sign',
      label: 'Both confirm the same terms',
      detail:
        myConfirmed && theirConfirmed
          ? 'Both parties confirmed.'
          : myConfirmed
            ? `You confirmed. Waiting on ${them}.`
            : theirConfirmed
              ? `${them} confirmed. Your turn.`
              : 'Confirming makes the deal binding. Editing any term clears both confirmations.',
      owner: myConfirmed ? 'them' : 'you',
      done: ENGAGED.has(state) || (myConfirmed && theirConfirmed),
      blocked: !joined || !contributionsComplete || !termsComplete,
      action:
        !ENGAGED.has(state) && !myConfirmed
          ? { label: 'Confirm', kind: 'act', target: 'confirm' }
          : undefined,
    },
    {
      id: 'engage',
      short: 'Locked',
      label: collateralRequired ? 'Collateral locked' : 'Contract becomes binding',
      detail: collateralRequired
        ? 'Both sides post the deal stake via Stripe. Any deal cash is also charged from the payer via Stripe — handover is goods only.'
        : 'You are both identity verified, so collateral is optional. Any deal cash is still charged from the payer via Stripe.',
      owner: 'platform',
      done: state === 'ESCROW_LOCKED' || state === 'COMPLETED' || state === 'DISPUTED',
      action: {
        label: 'Collateral',
        kind: 'focus',
        target: DEAL_SECTIONS.collateral,
        tone: 'secondary',
      },
    },
  ];

  // `!cancelled`: a deal unwound BY arbitration has `haltedAt === 'DISPUTED'`, which
  // would otherwise return a live plan for a deal that is over.
  if (!cancelled && state === 'DISPUTED') {
    drafts.push({
      id: 'dispute',
      // 'Review' keeps the six-tick disputed rail under the truncation budget
      // and matches the label "Dispute under review".
      short: 'Review',
      label: 'Dispute under review',
      detail:
        'Collateral and any Stripe deal cash stay locked while the case is reviewed.',
      owner: 'platform',
      done: false,
    });
    return sequenceSteps(drafts);
  }

  drafts.push({
    id: 'complete',
    short: 'Done',
    label: 'Both mark the handover complete',
    detail:
      iMarkedComplete && theyMarkedComplete
        ? 'Both parties marked it complete; collateral released and Stripe cash settled.'
        : iMarkedComplete
          ? `You marked it complete. Waiting on ${them}.`
          : theyMarkedComplete
            ? `${them} marked it complete. Your turn.`
            : 'Hand over goods, then you both mark complete to release collateral and settle Stripe cash.',
    owner: iMarkedComplete ? 'them' : 'you',
    done: state === 'COMPLETED',
    action:
      state === 'ESCROW_LOCKED' && !iMarkedComplete
        ? { label: 'Mark complete', kind: 'act', target: 'complete' }
        : undefined,
  });

  return cancelled
    ? sequenceHaltedSteps(drafts, dealHaltOutcome(facts.disputeOutcome ?? null))
    : sequenceSteps(drafts);
}

/**
 * Halt copy for a cancelled deal.
 *
 * `dispute_outcome` is the ONLY thing distinguishing an arbitrated unwind from a
 * plain pre-binding cancellation, since both land in CANCELLED. Every branch below
 * states collateral was released, because a deal has no Friction_Tax and no fraud
 * finding — capturing a party's collateral would impose a penalty they were never
 * told about.
 */
function dealHaltOutcome(
  outcome: 'REFUND_PAYER' | 'SPLIT' | 'RELEASE_RECIPIENT' | null,
): { label: string; detail: string; short: string } {
  switch (outcome) {
    case 'REFUND_PAYER':
      return {
        label: 'Unwound here by support',
        short: 'Unwound',
        detail:
          'A dispute was decided in the payer\u2019s favour at this step. The cash authorisation was released, so nobody was charged, and collateral was released on both sides.',
      };
    case 'SPLIT':
      return {
        label: 'Split here by support',
        short: 'Split',
        detail:
          'A dispute was settled at this step on adjusted terms: the arbitrated share of the cash was captured and the remainder released. Collateral was released on both sides.',
      };
    case 'RELEASE_RECIPIENT':
      return {
        label: 'Decided here by support',
        short: 'Decided',
        detail:
          'A dispute was not upheld at this step, so the cash was captured in full as agreed. Collateral was released on both sides.',
      };
    default:
      return {
        label: 'Cancelled here',
        short: 'Cancelled',
        detail:
          'The deal ended at this step. The share link no longer works, nothing was charged, and any collateral was released.',
      };
  }
}
