// domain/contract/postageSteps.ts
//
// The POSTAGE journey, as its own four-step plan.
//
// This is deliberately not `deriveTradeSteps`. That plan is the whole contract —
// collateral, handover, acceptance, release — and it belongs to the action card at
// the top of the room, which answers "what do I do next about this trade". The
// Terms tab is answering a narrower question: where are the two parcels up to.
// Rendering the contract-wide rail there made the tab restate the header, with
// collateral ticks in a tab that has nothing to do with collateral.
//
// Four steps, because a posted swap has exactly four states worth naming: nothing
// can be sent yet, it is in the post, it has arrived, it is over. Both directions
// are folded into each step — a trade only advances when the second parcel does,
// so a plan that split them would spend half its ticks on a state neither trader
// can act on alone.
//
// Pure: no React, no Supabase.

import type {
  TradeFacts,
  TradeState,
  TradeViewerRole,
} from '@/domain/state-machine/types';
import { sequenceSteps, type ContractStep, type ContractStepDraft } from './steps';

export interface PostageStepFacts {
  state: TradeState;
  viewerRole: TradeViewerRole;
  /** The aggregate legs the state machine derives from the trade row + holds. */
  facts: TradeFacts;
  counterpartyName: string;
  /** Whether each trader has a postal address on the contract. */
  addresses: { mine: boolean; theirs: boolean };
  /**
   * The cash leg, already formatted, when the trade has one.
   *
   * Named in the final step because "cash and collateral released" is two
   * different releases and only one of them is a payment — a reader with $20 owed
   * to them wants to see the figure, not the category.
   */
  cashLabel?: string | null;
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
 * Whose move a symmetric step is.
 *
 * `both` while neither has acted, `them` once the viewer has done their half, and
 * `you` when the viewer is the one holding it up. A step nobody can advance yet —
 * because an earlier step is unfinished — is still owned by `both`; the sequencer
 * marks it upcoming, so the owner never surfaces.
 */
function symmetricOwner(pair: { mine: boolean; theirs: boolean }) {
  if (pair.mine && !pair.theirs) return 'them' as const;
  if (!pair.mine && pair.theirs) return 'you' as const;
  return 'both' as const;
}

/** States at or beyond INSPECTION, i.e. both parcels have landed. */
const EXCHANGED: ReadonlySet<TradeState> = new Set<TradeState>([
  'INSPECTION',
  'COMPLETED',
]);

/**
 * Build the four-step postage plan for a posted trade.
 *
 * Only meaningful for `DELIVERY`. A face-to-face trade has no parcels, so the
 * Terms tab shows the meeting instead and never calls this.
 */
export function derivePostageSteps(input: PostageStepFacts): ContractStep[] {
  const { state, viewerRole, facts, counterpartyName, addresses } = input;

  const shipped = legs(facts.shipped, viewerRole);
  const received = legs(facts.received, viewerRole);
  const exchanged = EXCHANGED.has(state);
  const addressed = addresses.mine && addresses.theirs;

  const drafts: ContractStepDraft[] = [
    {
      id: 'postage-addresses',
      short: 'Before posting',
      caption: 'Both sides add an address',
      label: 'Before posting',
      detail: addressed
        ? 'Both addresses are in, so either side can post.'
        : addresses.mine
          ? `Your address is in. Waiting on ${counterpartyName}.`
          : 'Each side adds a delivery address, then posts with tracking.',
      owner: symmetricOwner({ mine: addresses.mine, theirs: addresses.theirs }),
      done: addressed || shipped.both || exchanged,
    },
    {
      id: 'postage-posted',
      short: 'Posted',
      caption: 'Tracking added, parcels on the way',
      label: 'Posted',
      detail: 'Each side posts and records a tracking number.',
      owner: symmetricOwner(shipped),
      done: shipped.both || exchanged,
    },
    {
      id: 'postage-received',
      short: 'Received',
      caption: 'Both confirm what arrived',
      label: 'Received',
      detail:
        'The receiver checks the card matches the listing, then confirms. Both must.',
      owner: symmetricOwner(received),
      done: received.both || exchanged,
    },
    {
      id: 'postage-complete',
      short: 'Complete',
      caption: 'Cash and collateral released',
      label: 'Complete',
      detail: input.cashLabel
        ? `Stripe releases the ${input.cashLabel} top-up and the holds drop off.`
        : 'The collateral holds drop off and the trade closes.',
      owner: 'platform',
      done: state === 'COMPLETED',
    },
  ];

  return sequenceSteps(drafts);
}
