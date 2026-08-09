// domain/contract/tradeSteps.ts
//
// The 2-way Trade action plan. Derived from the live Trade_State plus the aggregate
// TradeFacts the state machine already consumes, so the plan and the permitted
// actions can never disagree.
//
// Trades are SYMMETRIC: every step needs both traders, and the state only advances
// when the second one acts. That is why most steps are owned by `both` and their
// detail line names whoever is outstanding.
//
// The plan BRANCHES on the fulfilment method, because the two methods reach
// INSPECTION by genuinely different routes: a posted trade ships and confirms
// arrival, a face-to-face one meets once. Before 0057 the rail showed "Send" and
// "Receive" for both, so two people arranging to meet in a car park were told to post
// their cards.
//
// Step actions are all `focus` rather than `act`: `ActionBar` remains the single
// place trade actions are wired, and the plan points at it.

import type { TradeFacts, TradeState, TradeViewerRole } from '@/domain/state-machine/types';
import { sequenceSteps, type ContractStep, type ContractStepDraft } from './steps';

/** Section ids the trade plan's `focus` actions point at. */
export const TRADE_SECTIONS = {
  actions: 'contract-actions',
  exchange: 'contract-exchange',
  terms: 'contract-terms',
  money: 'contract-money',
  collateral: 'contract-collateral',
  /** Participant evidence, present only while the trade is DISPUTED (0082). */
  dispute: 'contract-dispute',
} as const;

/** Everything the trade plan needs. */
export interface TradeStepFacts {
  state: TradeState;
  viewerRole: TradeViewerRole;
  /** The aggregate legs the state machine derives from the trade row + holds. */
  facts: TradeFacts;
  counterpartyName: string;
  /**
   * Whether each trader has supplied a postal address, for a posted trade. Absent on
   * a face-to-face trade. Without both, one side literally cannot post — which is why
   * this is a step rather than a validation message discovered at the shipping dialog.
   */
  addresses?: { mine: boolean; theirs: boolean };
}

/** Read one leg of a symmetric pair from the viewer's perspective. */
function legs(
  pair: { initiator: boolean; counterpart: boolean },
  viewerRole: TradeViewerRole,
): { mine: boolean; theirs: boolean; both: boolean } {
  const mine = viewerRole === 'INITIATOR' ? pair.initiator : pair.counterpart;
  const theirs = viewerRole === 'INITIATOR' ? pair.counterpart : pair.initiator;
  return { mine, theirs, both: mine && theirs };
}

/**
 * Detail copy for a symmetric step: who has done their half.
 *
 * @param verb - Past-tense verb, e.g. `shipped`.
 */
function symmetricDetail(
  pair: { mine: boolean; theirs: boolean },
  counterpartyName: string,
  verb: string,
  pending: string,
): string {
  if (pair.mine && pair.theirs) return `Both traders ${verb}.`;
  if (pair.mine) return `You ${verb}. Waiting on ${counterpartyName}.`;
  if (pair.theirs) return `${counterpartyName} ${verb}. Your turn.`;
  return pending;
}

/** States at or beyond INSPECTION, i.e. the goods have changed hands. */
const EXCHANGED: ReadonlySet<TradeState> = new Set<TradeState>([
  'INSPECTION',
  'COMPLETED',
]);

/**
 * Build the ordered action plan for a 2-way trade.
 *
 * A trade that ends in DISPUTED or FRAUD_RESOLVED collapses its remaining steps:
 * the outcome is decided off-platform, so showing unreachable shipping steps would
 * be misleading.
 */
export function deriveTradeSteps(input: TradeStepFacts): ContractStep[] {
  const { state, viewerRole, facts, counterpartyName } = input;

  if (state === 'FRAUD_RESOLVED') {
    return sequenceSteps([
      {
        id: 'fraud',
        short: 'Fraud',
        label: 'Closed as fraud',
        detail:
          "The other trader's collateral was captured and the fraud outcome was recorded.",
        owner: 'platform',
        done: true,
      },
    ]);
  }

  const shipped = legs(facts.shipped, viewerRole);
  const received = legs(facts.received, viewerRole);
  const accepted = legs(facts.accepted, viewerRole);
  const handover = legs(facts.handoverConfirmed, viewerRole);
  const holds = legs(facts.holdsActive, viewerRole);
  const inPerson = facts.fulfilmentMethod === 'IN_PERSON';

  const drafts: ContractStepDraft[] = [
    {
      id: 'collateral',
      // Rail shorts must fit a five-tick rail on a 320px screen (~6
      // characters). 'Holds' matches the release step's "Both holds released".
      short: 'Holds',
      label: 'Both traders post collateral',
      detail: symmetricDetail(
        holds,
        counterpartyName,
        'posted collateral',
        'Each trader authorises a hold for the full value of what they receive. Nothing is charged unless the trade goes wrong.',
      ),
      owner: 'both',
      done: state !== 'COLLATERAL_PENDING' && state !== 'NEGOTIATING',
      action: {
        label: 'What is on the line',
        kind: 'focus',
        target: TRADE_SECTIONS.collateral,
        tone: 'secondary',
      },
    },
  ];

  if (state === 'DISPUTED') {
    drafts.push({
      id: 'dispute',
      // 'Review' matches the cash-sale rail for the same state.
      short: 'Review',
      label: 'Frozen for review',
      detail:
        'Both holds stay active while an operator reviews the case. A condition dispute settles with a fixed friction tax; a failed handover or a lost parcel captures nothing.',
      owner: 'platform',
      done: false,
    });
    return sequenceSteps(drafts);
  }

  if (inPerson) {
    // Face to face: one mutual confirmation instead of a shipping round trip. Note
    // it does NOT complete the trade — it lands on INSPECTION, so a trader who was
    // robbed, coerced, or handed a fake at the meeting point still has a remedy.
    drafts.push({
      id: 'handover',
      // Rail shorts must survive a five-tick rail on a 320px screen (~6
      // characters); 'Handover' truncates to 'Handov…'.
      short: 'Meet',
      label: 'Meet and swap',
      detail: symmetricDetail(
        handover,
        counterpartyName,
        'confirmed the handover',
        'Meet at the agreed place and time, swap, then you both confirm here. Confirming does not release either deposit.',
      ),
      owner: handover.mine ? 'them' : 'you',
      done: handover.both || EXCHANGED.has(state),
      action: {
        label: 'Go to actions',
        kind: 'focus',
        target: TRADE_SECTIONS.actions,
      },
    });
  } else {
    // Posted: addresses, then two parcels, then two arrivals.
    if (input.addresses) {
      const addresses = input.addresses;
      drafts.push({
        id: 'addresses',
        short: 'Address',
        label: 'Both traders add a delivery address',
        detail: symmetricDetail(
          { mine: addresses.mine, theirs: addresses.theirs },
          counterpartyName,
          'added an address',
          'Neither of you can post until both addresses are on the contract. They are private and never appear in chat.',
        ),
        owner: addresses.mine ? 'them' : 'you',
        done: (addresses.mine && addresses.theirs) || shipped.both || EXCHANGED.has(state),
        action: {
          label: 'Add your address',
          kind: 'focus',
          target: TRADE_SECTIONS.terms,
        },
      });
    }

    drafts.push(
      {
        id: 'ship',
        short: 'Send',
        label: 'Both traders post with tracking',
        detail: symmetricDetail(
          shipped,
          counterpartyName,
          'posted their item',
          'Post your item and record the carrier and tracking number.',
        ),
        owner: shipped.mine ? 'them' : 'you',
        done: shipped.both || EXCHANGED.has(state),
        action: {
          label: 'Go to actions',
          kind: 'focus',
          target: TRADE_SECTIONS.actions,
        },
      },
      {
        id: 'receive',
        short: 'Arrive',
        label: 'Both parcels arrive',
        detail: symmetricDetail(
          received,
          counterpartyName,
          'confirmed receipt',
          'Confirm when the other trader’s item reaches you. A carrier-confirmed delivery also counts.',
        ),
        owner: received.mine ? 'them' : 'you',
        done: received.both || EXCHANGED.has(state),
        action: {
          label: 'Go to actions',
          kind: 'focus',
          target: TRADE_SECTIONS.actions,
        },
      },
    );
  }

  drafts.push(
    {
      id: 'accept',
      short: 'Accept',
      label: 'Both traders accept what they got',
      detail: symmetricDetail(
        accepted,
        counterpartyName,
        'accepted',
        'Inspect what you received, then accept to release both holds — or raise a dispute. Completes on its own after 72 hours.',
      ),
      owner: accepted.mine ? 'them' : 'you',
      done: state === 'COMPLETED',
      action: {
        label: 'Go to actions',
        kind: 'focus',
        target: TRADE_SECTIONS.actions,
      },
    },
    {
      id: 'release',
      // Terminal tick reads 'Done' in every flow.
      short: 'Done',
      label: 'Both holds released',
      detail: 'Neither card is charged once the swap completes.',
      owner: 'platform',
      done: state === 'COMPLETED' && !holds.mine && !holds.theirs,
    },
  );

  return sequenceSteps(drafts);
}
