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
 * Build the ordered action plan for a cash sale.
 *
 * Terminal contracts (cancelled, failed, refunded) collapse to a single closed
 * step — there is no "next" to show. A disputed contract keeps its history and
 * ends on a platform-owned review step, because neither party can act.
 */
export function deriveCashSaleSteps(facts: CashSaleStepFacts): ContractStep[] {
  const {
    status,
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

  if (CLOSED.has(status)) {
    return sequenceSteps([
      {
        id: 'closed',
        short: 'Closed',
        label:
          status === 'CANCELLED'
            ? 'Contract cancelled'
            : status === 'FAILED'
              ? 'Payment failed'
              : 'Payment refunded',
        detail:
          status === 'CANCELLED'
            ? 'The agreement ended and the item returned to the catalog.'
            : status === 'FAILED'
              ? 'The payment could not be collected, so the item returned to the catalog.'
              : 'The buyer has been refunded in full.',
        owner: 'platform',
        done: true,
      },
    ]);
  }

  const drafts: ContractStepDraft[] = [];

  // 1. Somebody proposes how the item changes hands. Either party may.
  drafts.push({
    id: 'terms',
    short: 'Terms',
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
          label: 'Choose a method',
          kind: 'focus',
          target: CASH_SALE_SECTIONS.terms,
        },
  });

  // 2. Both sides accept the SAME version. Money moves only then.
  drafts.push({
    id: 'accept',
    short: 'Accept',
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
    label: 'Payment clears into escrow',
    detail:
      viewerRole === 'BUYER'
        ? 'Your payment method is charged and the funds are held by Poke-xchange.'
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
  if (status === 'DISPUTED') {
    drafts.push({
      id: 'dispute',
      short: 'Dispute',
      label: 'Dispute under review',
      detail: facts.disputeRaisedByMe
        ? 'You raised a dispute. Funds stay in escrow while the case is reviewed.'
        : `${counterpartyName} raised a dispute. Funds stay in escrow while the case is reviewed.`,
      owner: 'platform',
      done: false,
    });
    return sequenceSteps(drafts);
  }

  if (isDelivery) {
    // 4a. Shipping branch: the seller sends, the buyer confirms arrival.
    drafts.push({
      id: 'ship',
      short: 'Ship',
      label: 'Seller ships with tracking',
      detail: hasTracking
        ? 'Tracking recorded.'
        : viewerRole === 'SELLER'
          ? 'Add the carrier and tracking number once you have posted it.'
          : `${counterpartyName} adds tracking once the item is posted.`,
      owner: ownerFor('SELLER', viewerRole),
      done: status === 'IN_TRANSIT' || WITH_BUYER.has(status),
      action:
        viewerRole === 'SELLER' && status === 'ESCROW_HELD'
          ? { label: 'Add tracking', kind: 'focus', target: CASH_SALE_SECTIONS.actions }
          : undefined,
    });

    drafts.push({
      id: 'receive',
      short: 'Delivered',
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
      short: 'Handover',
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
    short: 'Done',
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

  return sequenceSteps(drafts);
}
