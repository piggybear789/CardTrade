// domain/contract/tradeSteps.ts
//
// The 2-way Trade action plan (Req 6, 7, 11). Derived from the live Trade_State
// plus the aggregate TradeFacts the state machine already consumes, so the plan
// and the permitted actions can never disagree.
//
// Trades are SYMMETRIC: every step needs both traders, and the state only advances
// when the second one acts. That is why most steps are owned by `both` and their
// detail line names whoever is outstanding.
//
// Step actions are all `focus` rather than `act`: `ActionBar` remains the single
// place trade actions are wired, and the plan points at it.

import type { TradeFacts, TradeState, TradeViewerRole } from '@/domain/state-machine/types';
import { sequenceSteps, type ContractStep, type ContractStepDraft } from './steps';

/** Section ids the trade plan's `focus` actions point at. */
export const TRADE_SECTIONS = {
  actions: 'contract-actions',
  exchange: 'contract-exchange',
  collateral: 'contract-collateral',
} as const;

/** Everything the trade plan needs. */
export interface TradeStepFacts {
  state: TradeState;
  viewerRole: TradeViewerRole;
  /** The aggregate legs the state machine derives from the trade row + holds. */
  facts: TradeFacts;
  counterpartyName: string;
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

/**
 * Build the ordered action plan for a 2-way trade.
 *
 * A trade that ends in DISPUTED or FRAUD_RESOLVED collapses its remaining steps:
 * the outcome is decided off-platform (dispute review, evidence pack), so showing
 * unreachable shipping steps would be misleading.
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
          "The other trader's collateral was captured and a Police Evidence Pack was generated.",
        owner: 'platform',
        done: true,
      },
    ]);
  }

  const shipped = legs(facts.shipped, viewerRole);
  const received = legs(facts.received, viewerRole);
  const accepted = legs(facts.accepted, viewerRole);
  const holds = legs(facts.holdsActive, viewerRole);

  const drafts: ContractStepDraft[] = [
    {
      id: 'collateral',
      short: 'Collateral',
      label: 'Both traders post collateral',
      detail: symmetricDetail(
        holds,
        counterpartyName,
        'posted collateral',
        'An unverified trader authorises a hold for the full value of their item. Nothing is charged unless the trade goes wrong.',
      ),
      owner: 'both',
      done: state !== 'COLLATERAL_PENDING',
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
      short: 'Dispute',
      label: 'Dispute under review',
      detail:
        'Both holds stay active while the case is reviewed. A condition dispute settles with a fixed friction tax; objective fraud captures the full collateral.',
      owner: 'platform',
      done: false,
    });
    return sequenceSteps(drafts);
  }

  drafts.push(
    {
      id: 'ship',
      short: 'Send',
      label: 'Both traders send their items',
      detail: symmetricDetail(
        shipped,
        counterpartyName,
        'sent their item',
        'Send your item once collateral is locked on both sides.',
      ),
      owner: shipped.mine ? 'them' : 'you',
      done: shipped.both,
      action: {
        label: 'Go to actions',
        kind: 'focus',
        target: TRADE_SECTIONS.actions,
      },
    },
    {
      id: 'receive',
      short: 'Receive',
      label: 'Both traders confirm receipt',
      detail: symmetricDetail(
        received,
        counterpartyName,
        'confirmed receipt',
        'Confirm when the other trader’s item reaches you.',
      ),
      owner: received.mine ? 'them' : 'you',
      done: received.both,
      action: {
        label: 'Go to actions',
        kind: 'focus',
        target: TRADE_SECTIONS.actions,
      },
    },
    {
      id: 'accept',
      short: 'Accept',
      label: 'Both traders accept what they got',
      detail: symmetricDetail(
        accepted,
        counterpartyName,
        'accepted',
        'Inspect the item, then accept to void both holds — or raise a dispute.',
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
      short: 'Released',
      label: 'Both holds released',
      detail: 'Neither card is charged once the swap completes.',
      owner: 'platform',
      done: state === 'COMPLETED' && !holds.mine && !holds.theirs,
    },
  );

  return sequenceSteps(drafts);
}
