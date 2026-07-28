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

import { sequenceSteps, type ContractStep, type ContractStepDraft } from './steps';

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
  exchange: 'contract-exchange',
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
    state,
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

  if (state === 'CANCELLED') {
    return sequenceSteps([
      {
        id: 'closed',
        short: 'Cancelled',
        label: 'Deal cancelled',
        detail: 'The share link no longer works and nothing was charged.',
        owner: 'platform',
        done: true,
      },
    ]);
  }

  const drafts: ContractStepDraft[] = [
    {
      id: 'join',
      short: 'Join',
      label: 'The other party joins',
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
      short: 'Evidence',
      label: 'Both sides document what they bring',
      detail: contributionsComplete
        ? 'Item details and evidence photos are on the record for both sides.'
        : 'Each person adds their own item details and evidence photos. These become part of the deal record.',
      owner: 'both',
      done: contributionsComplete,
      action: contributionsComplete
        ? undefined
        : { label: 'Add your side', kind: 'focus', target: DEAL_SECTIONS.exchange },
    },
    {
      id: 'terms',
      short: 'Terms',
      label: 'Agree the handover',
      detail: termsComplete
        ? 'Handover method and details are set.'
        : 'Choose a face-to-face meeting or a delivery, and fill in the details.',
      owner: 'both',
      done: termsComplete,
      action: termsComplete
        ? undefined
        : { label: 'Agree terms', kind: 'focus', target: DEAL_SECTIONS.terms },
    },
    {
      id: 'confirm',
      short: 'Confirm',
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
      short: 'Binding',
      label: collateralRequired ? 'Collateral locked' : 'Contract becomes binding',
      detail: collateralRequired
        ? 'Both cards are authorised for the deal stake. Nothing is charged unless somebody fails to deliver.'
        : 'You are both identity verified, so the deal binds on your identities with no card involved.',
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

  if (state === 'DISPUTED') {
    drafts.push({
      id: 'dispute',
      short: 'Dispute',
      label: 'Dispute under review',
      detail: 'Collateral stays held on both sides while the case is reviewed.',
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
        ? 'Both parties marked it complete and the collateral was released.'
        : iMarkedComplete
          ? `You marked it complete. Waiting on ${them}.`
          : theyMarkedComplete
            ? `${them} marked it complete. Your turn.`
            : 'Meet, swap, then you both mark it complete to release the collateral.',
    owner: iMarkedComplete ? 'them' : 'you',
    done: state === 'COMPLETED',
    action:
      state === 'ESCROW_LOCKED' && !iMarkedComplete
        ? { label: 'Mark complete', kind: 'act', target: 'complete' }
        : undefined,
  });

  return sequenceSteps(drafts);
}
