// domain/contract/cashSaleSteps.ts
//
// The Cash_Sale action plan (Req 4). Turns a sale's live facts into the ordered
// list of steps the contract room shows: agree terms, both accept, payment
// clears, the item changes hands, the buyer accepts it.
//
// Pure: takes plain facts rather than a Supabase row, so the room maps its row in
// and this can be tested in the Node-only Vitest project.

import type { CashSaleStatus } from '@/domain/orchestrator/cashSaleOrchestrator';
import {
  sequenceHaltedSteps,
  sequenceSteps,
  type ContractStep,
  type ContractStepDraft,
  type ContractStepOwner,
} from './steps';

/** Section ids the plan's `focus` actions point at. Kept with the derivation so
 *  the room and the plan cannot drift apart. */
export const CASH_SALE_SECTIONS = {
  /** The live controls: ship, confirm receipt, confirm handover, accept, dispute. */
  actions: 'contract-actions',
  exchange: 'contract-exchange',
  parties: 'contract-parties',
  terms: 'contract-terms',
  payment: 'contract-payment',
  collateral: 'contract-collateral',
  /** Participant evidence, present only while the contract is DISPUTED (0082). */
  dispute: 'contract-dispute',
  history: 'contract-history',
} as const;

/** Everything the plan needs, derived from the live `cash_sales` row. */
export interface CashSaleStepFacts {
  status: CashSaleStatus;
  /** Which side the viewer is on. */
  viewerRole: 'BUYER' | 'SELLER';
  /** The other party's display name, for "waiting on …" copy. */
  counterpartyName: string;
  /** True once a fulfillment method has been chosen. */
  termsSet: boolean;
  termsVersion: number;
  /** Whether each side has accepted the CURRENT terms version. */
  iAccepted: boolean;
  theyAccepted: boolean;
  /** DELIVERY (ship with tracking) vs IN_PERSON (mutual handover). */
  isDelivery: boolean;
  /** A carrier + tracking number have been recorded. */
  hasTracking: boolean;
  /** Handover confirmations, for the in-person branch. */
  myHandoverConfirmed: boolean;
  theirHandoverConfirmed: boolean;
  /** Set while the sale is DISPUTED, for the dispute step's detail line. */
  disputeRaisedByMe?: boolean;
  /**
   * For a closed sale: the status it was in immediately before it went terminal,
   * i.e. `from_status` on the event that closed it.
   *
   * Supplying this is what makes "cancelled at Payment" exact rather than guessed.
   * Once `status` is CANCELLED / FAILED / REFUNDED it no longer says how far the
   * contract got, and every `done` predicate keyed on `status` collapses to false.
   * Omit it and the plan falls back to {@link inferHaltStatus}, which is
   * conservative and can under-report progress.
   */
  haltedAt?: CashSaleStatus | null;
}

/** Statuses where the contract is closed and no plan remains. */
const CLOSED: ReadonlySet<CashSaleStatus> = new Set<CashSaleStatus>([
  'CANCELLED',
  'FAILED',
  'REFUNDED',
]);

/** Statuses reached only after the buyer's payment has cleared. */
const FUNDS_CLEARED: ReadonlySet<CashSaleStatus> = new Set<CashSaleStatus>([
  'ESCROW_HELD',
  'IN_TRANSIT',
  'HANDOVER',
  'INSPECTION',
  'COMPLETED',
  'DISPUTED',
]);

/** Statuses reached only after the item is with the buyer. */
const WITH_BUYER: ReadonlySet<CashSaleStatus> = new Set<CashSaleStatus>([
  'INSPECTION',
  'COMPLETED',
]);

/** Resolve a role-owned step to the viewer's perspective. */
function ownerFor(
  role: 'BUYER' | 'SELLER',
  viewerRole: 'BUYER' | 'SELLER',
): ContractStepOwner {
  return role === viewerRole ? 'you' : 'them';
}

/**
 * Best guess at how far a closed sale got, when `haltedAt` was not supplied.
 *
 * Deliberately conservative: it may under-report progress but will not claim a
 * step finished that might not have. A REFUNDED sale is the one certainty — money
 * cannot be refunded without having been collected first.
 */
function inferHaltStatus(status: CashSaleStatus): CashSaleStatus {
  if (status === 'REFUNDED') return 'ESCROW_HELD';
  // FAILED means collection was attempted and did not clear; CANCELLED is most
  // often pre-payment. Both land before payment collection, and surviving facts (tracking,
  // handover confirmations) still promote later steps on their own.
  return 'AGREEMENT';
}

/** Outcome copy for the halt point of a closed sale. */
function haltOutcome(status: CashSaleStatus): {
  label: string;
  detail: string;
  short: string;
} {
  switch (status) {
    case 'CANCELLED':
      return {
        label: 'Cancelled here',
        short: 'Cancelled',
        detail:
          'The agreement ended at this step and the item returned to the catalog. Nothing further was charged.',
      };
    case 'FAILED':
      return {
        label: 'Payment failed here',
        short: 'Failed',
        detail:
          'The payment could not be collected at this step, so the item returned to the catalog.',
      };
    default:
      return {
        label: 'Refunded here',
        short: 'Refunded',
        detail: 'The contract ended at this step and the buyer was refunded in full.',
      };
  }
}

/**
 * Build the ordered action plan for a cash sale.
 *
 * A CLOSED contract (cancelled, failed, refunded) keeps its full timeline and marks
 * the step it stopped at, rather than collapsing to one "Closed" tick. Seeing that a
 * sale died at Payment rather than at Terms is most of what you want to know after the
 * fact, and the collapsed version also rendered a success tick on a contract that had
 * been cancelled.
 *
 * A disputed contract keeps its history and ends on a platform-owned review step,
 * because neither party can act.
 */
export function deriveCashSaleSteps(facts: CashSaleStepFacts): ContractStep[] {
  const {
    viewerRole,
    counterpartyName,
    termsSet,
    iAccepted,
    theyAccepted,
    isDelivery,
    hasTracking,
    myHandoverConfirmed,
    theirHandoverConfirmed,
  } = facts;

  const closed = CLOSED.has(facts.status);

  // The status to reason about PROGRESS with. Once a sale is terminal its own status
  // says nothing about how far it got, so the halt point stands in — otherwise every
  // `done` predicate below reads false and a sale cancelled at inspection would look
  // identical to one cancelled at terms.
  const status: CashSaleStatus = closed
    ? (facts.haltedAt ?? inferHaltStatus(facts.status))
    : facts.status;

  const drafts: ContractStepDraft[] = [];

  // 1. Somebody proposes how the item changes hands. Either party may.
  drafts.push({
    id: 'terms',
    short: 'Discuss Terms',
    label: 'Propose handover terms',
    detail: termsSet
      ? isDelivery
        ? 'Shipping with tracking.'
        : 'Face-to-face handover.'
      : 'Choose shipping or meet-up, then add the details for both parties to accept.',
    owner: 'both',
    done: termsSet,
    action: termsSet
      ? undefined
      : {
          label: 'Select delivery method',
          kind: 'focus',
          target: CASH_SALE_SECTIONS.terms,
        },
  });

  // 2. Both sides accept the SAME version. Money moves only then.
  drafts.push({
    id: 'accept',
    short: 'Accept Terms',
    label: 'Review and accept the proposal',
    detail: !termsSet
      ? 'Available once handover terms have been proposed.'
      : iAccepted && theyAccepted
        ? 'Both parties accepted the current proposal.'
        : iAccepted
          ? `You accepted. Waiting on ${counterpartyName}.`
          : theyAccepted
            ? `${counterpartyName} accepted. Review and accept to continue.`
            : 'Both parties must accept before payment begins.',
    owner: iAccepted ? 'them' : 'you',
    done: status !== 'AGREEMENT',
    blocked: !termsSet,
    action:
      status === 'AGREEMENT' && termsSet && !iAccepted
        ? { label: 'Accept terms', kind: 'act', target: 'accept' }
        : undefined,
  });

  // 3. The buyer's payment is collected in full before anything ships.
  drafts.push({
    id: 'payment',
    short: 'Payment',
    label: 'Payment collected and held',
    detail:
      viewerRole === 'BUYER'
        ? 'Your payment method is charged and the funds are held by NoDitto.'
        : "The buyer's payment is collected and held before you send anything.",
    owner: 'platform',
    done: FUNDS_CLEARED.has(status),
    action: {
      label: 'Payment terms',
      kind: 'focus',
      target: CASH_SALE_SECTIONS.payment,
      tone: 'secondary',
    },
  });

  // A dispute suspends the remaining fulfillment steps: neither party can act on
  // them while the case is open, so the plan ends here rather than showing steps
  // that are unreachable.
  // `!closed` guard: a sale refunded OUT of a dispute has `haltedAt === 'DISPUTED'`,
  // which would otherwise take this branch and return a live plan for a contract that
  // is over.
  if (!closed && status === 'DISPUTED') {
    drafts.push({
      id: 'dispute',
      // 'Review' matches the deal and trade rails for the same state.
      short: 'Review',
      label: 'Dispute under review',
      detail: facts.disputeRaisedByMe
        ? 'You raised a dispute. Funds are held securely while the case is reviewed.'
        : `${counterpartyName} raised a dispute. Funds are held securely while the case is reviewed.`,
      owner: 'platform',
      done: false,
    });
    return sequenceSteps(drafts);
  }

  if (isDelivery) {
    // 4a. Shipping branch: the seller sends, the buyer confirms arrival.
    drafts.push({
      id: 'ship',
      short: 'Delivery',
      label: 'Seller ships with tracking',
      detail: hasTracking
        ? 'Tracking recorded.'
        : viewerRole === 'SELLER'
          ? 'Add the carrier and tracking number once you have posted it.'
          : `${counterpartyName} adds tracking once the item is posted.`,
      owner: ownerFor('SELLER', viewerRole),
      // `hasTracking` counts on its own so a closed sale still shows this finished
      // when the halt point is coarser than the facts.
      done: hasTracking || status === 'IN_TRANSIT' || WITH_BUYER.has(status),
      action:
        viewerRole === 'SELLER' && status === 'ESCROW_HELD'
          ? { label: 'Add tracking', kind: 'focus', target: CASH_SALE_SECTIONS.actions }
          : undefined,
    });

    drafts.push({
      id: 'receive',
      // Six ticks in the delivery branch: keep short for mobile.
      short: 'Received',
      label: 'Buyer confirms the item arrived',
      detail:
        viewerRole === 'BUYER'
          ? 'Confirm receipt, or report it as not received.'
          : `${counterpartyName} confirms receipt on arrival.`,
      owner: ownerFor('BUYER', viewerRole),
      done: WITH_BUYER.has(status),
      action:
        viewerRole === 'BUYER' && status === 'IN_TRANSIT'
          ? { label: 'Confirm receipt', kind: 'focus', target: CASH_SALE_SECTIONS.actions }
          : undefined,
    });
  } else {
    // 4b. In-person branch: a single mutual confirmation.
    drafts.push({
      id: 'handover',
      // Rail shorts must survive a five-tick rail on a 320px screen.
      short: 'Delivery',
      label: 'Both confirm the handover',
      detail:
        myHandoverConfirmed && theirHandoverConfirmed
          ? 'Both parties confirmed.'
          : myHandoverConfirmed
            ? `You confirmed. Waiting on ${counterpartyName}.`
            : theirHandoverConfirmed
              ? `${counterpartyName} confirmed. Your turn.`
              : 'Meet, swap, then you both confirm here.',
      owner: myHandoverConfirmed ? 'them' : 'you',
      done:
        WITH_BUYER.has(status) || (myHandoverConfirmed && theirHandoverConfirmed),
      action:
        status === 'HANDOVER' && !myHandoverConfirmed
          ? {
              label: 'Confirm handover',
              kind: 'focus',
              target: CASH_SALE_SECTIONS.actions,
            }
          : undefined,
    });
  }

  // 5. The buyer's inspection window closes the contract and releases funds.
  drafts.push({
    id: 'inspect',
    short: '',
    label: 'Buyer accepts the item',
    detail:
      viewerRole === 'BUYER'
        ? 'Accept to release the funds, or raise a dispute. Accepts automatically when the window closes.'
        : `Funds are released once ${counterpartyName} accepts, or the inspection window closes.`,
    owner: ownerFor('BUYER', viewerRole),
    done: status === 'COMPLETED',
    action:
      viewerRole === 'BUYER' && status === 'INSPECTION'
        ? { label: 'Accept or dispute', kind: 'focus', target: CASH_SALE_SECTIONS.actions }
        : undefined,
  });

  return closed
    ? sequenceHaltedSteps(drafts, haltOutcome(facts.status))
    : sequenceSteps(drafts);
}
