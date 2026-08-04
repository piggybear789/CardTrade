// domain/contract/steps.ts
//
// The contract ACTION PLAN — the shared vocabulary behind every contract room's
// "what happens next, and whose move is it" panel.
//
// A Cash_Sale, a 2-way Trade and a private Deal are three different state
// machines, but each one is a short ordered sequence of steps where exactly one
// is live and each has an owner. Previously that knowledge was implicit, spread
// across nested status ternaries in three separate view components. Here it is an
// explicit, ordered list derived by a pure function per flow, so it can be unit
// and property tested without a database or a DOM.
//
// This module is pure: no React, no Supabase, no service imports.

/**
 * Where a step sits in the sequence.
 *
 * - `done`     — finished; nothing more to do.
 * - `active`   — the live step. At most one per plan.
 * - `blocked`  — cannot start until an earlier step is finished.
 * - `upcoming` — later in the sequence.
 * - `halted`   — the contract ENDED here without completing. At most one per
 *                plan, and mutually exclusive with `active`: a closed contract
 *                has no live step. This is where it stopped, not a failure of
 *                the step itself.
 */
export type ContractStepStatus =
  | 'done'
  | 'active'
  | 'blocked'
  | 'upcoming'
  | 'halted';

/**
 * Whose move a step is.
 *
 * - `you`      — the viewer must act.
 * - `them`     — the counterparty must act.
 * - `both`     — either or both sides act; the step completes when both have.
 * - `platform` — NoDitto or the payment provider acts; nobody is waiting on
 *                a person (payment settling, a dispute under review).
 */
export type ContractStepOwner = 'you' | 'them' | 'both' | 'platform';

/** The control a step offers, if any. */
export interface ContractStepAction {
  /** Button label, e.g. `Accept v3` or `Set a delivery method`. */
  label: string;
  /**
   * - `act`   — the room runs a server action for this step; `target` is the
   *             action key the room switches on.
   * - `focus` — scroll to and expand the section that owns this step; `target`
   *             is that section's id.
   */
  kind: 'act' | 'focus';
  target: string;
  /** Presentation. Defaults to `primary` on the active step, `secondary` otherwise. */
  tone?: 'primary' | 'secondary' | 'destructive';
}

/** One step of a contract's action plan. */
export interface ContractStep {
  id: string;
  /** Imperative where the viewer must act, descriptive otherwise. */
  label: string;
  /**
   * One or two words for the progress rail, where there is only room for a tick
   * label. Falls back to `label`.
   */
  short?: string;
  /** One line of context: who is outstanding, what is missing, what happens next. */
  detail?: string;
  owner: ContractStepOwner;
  status: ContractStepStatus;
  action?: ContractStepAction;
}

/**
 * A step before its position in the sequence has been resolved. Flow-specific
 * derivations describe *what* each step is and whether it is finished;
 * {@link sequenceSteps} decides which one is live.
 */
export interface ContractStepDraft {
  id: string;
  label: string;
  /** One or two words for the progress rail. */
  short?: string;
  detail?: string;
  owner: ContractStepOwner;
  /** True once this step is finished. */
  done: boolean;
  /**
   * True when this step is next in line but cannot start yet — a prerequisite
   * outside the sequence is missing (no counterparty has joined, terms are
   * half-specified). Only consulted for the step that would otherwise be active.
   */
  blocked?: boolean;
  action?: ContractStepAction;
}

/**
 * Resolve an ordered list of drafts into a plan.
 *
 * The first unfinished step becomes `active` (or `blocked` if it says it cannot
 * start); everything after it is `upcoming`. This guarantees the plan's two
 * invariants by construction: at most one live step, and no `done` step ever
 * follows an unfinished one.
 *
 * A `done` draft that appears after an unfinished one is reported as `done`
 * anyway — flows legitimately complete out of order (an in-person handover can be
 * confirmed before tracking exists) — but it never claims to be the live step.
 */
export function sequenceSteps(drafts: ContractStepDraft[]): ContractStep[] {
  let liveAssigned = false;

  return drafts.map((draft) => {
    if (draft.done) {
      return {
        id: draft.id,
        label: draft.label,
        short: draft.short,
        detail: draft.detail,
        owner: draft.owner,
        status: 'done' as const,
        action: draft.action,
      };
    }

    let status: ContractStepStatus;
    if (liveAssigned) {
      status = 'upcoming';
    } else {
      liveAssigned = true;
      status = draft.blocked ? 'blocked' : 'active';
    }

    return {
      id: draft.id,
      label: draft.label,
      short: draft.short,
      detail: draft.detail,
      owner: draft.owner,
      status,
      action: draft.action,
    };
  });
}

/**
 * Resolve drafts into a plan for a contract that ENDED without completing.
 *
 * Terminal contracts used to collapse to a single "Closed" step, which threw away
 * the whole timeline: you could see that a sale was cancelled but not how far it
 * had got, and the lone step was rendered with a success tick — a contract that
 * was cancelled showing the same mark as one that completed.
 *
 * This keeps the full sequence instead. Finished steps stay `done`, the first
 * unfinished step becomes `halted` (that is where it stopped), and everything
 * after it is `upcoming` — never reached, and shown as such. No step is `active`,
 * so `currentStep` returns null and the room offers no controls.
 *
 * @param drafts The same drafts the live plan would build. Their `done` flags must
 *   be computed from facts that survive closure (recorded acceptances, tracking,
 *   handover confirmations) rather than from the now-terminal status.
 * @param outcome Copy for the halt point: what happened and what it means. Applied
 *   to the halted step, so the timeline explains itself at the place it stopped.
 */
export function sequenceHaltedSteps(
  drafts: ContractStepDraft[],
  outcome: { label: string; detail?: string; short?: string },
): ContractStep[] {
  let haltAssigned = false;

  const steps: ContractStep[] = drafts.map((draft) => {
    const base = {
      id: draft.id,
      label: draft.label,
      short: draft.short,
      detail: draft.detail,
      owner: draft.owner,
      // A closed contract offers no controls, whatever the draft suggested.
      action: undefined,
    };

    if (draft.done) return { ...base, status: 'done' as const };

    if (!haltAssigned) {
      haltAssigned = true;
      return {
        ...base,
        label: outcome.label,
        short: outcome.short ?? draft.short,
        detail: outcome.detail,
        owner: 'platform' as const,
        status: 'halted' as const,
      };
    }

    return { ...base, status: 'upcoming' as const };
  });

  // Every step finished yet the contract is terminal — a refund after acceptance,
  // for instance. There is no unfinished step to mark, so the outcome needs its own
  // position or it would not be stated anywhere.
  if (!haltAssigned) {
    steps.push({
      id: 'halted',
      label: outcome.label,
      short: outcome.short ?? 'Closed',
      detail: outcome.detail,
      owner: 'platform',
      status: 'halted',
    });
  }

  return steps;
}

/** The live step, or `null` when the plan is finished, halted, or entirely blocked. */
export function activeStep(steps: ContractStep[]): ContractStep | null {
  return steps.find((step) => step.status === 'active') ?? null;
}

/** The step a closed contract stopped at, or `null` while it is still running. */
export function haltedStep(steps: ContractStep[]): ContractStep | null {
  return steps.find((step) => step.status === 'halted') ?? null;
}

/**
 * The step the room should point at — the live one, or the blocked one that is
 * holding everything up.
 */
export function currentStep(steps: ContractStep[]): ContractStep | null {
  return (
    steps.find((step) => step.status === 'active' || step.status === 'blocked') ??
    null
  );
}

/** How far along the plan is, for a progress summary. */
export function stepProgress(steps: ContractStep[]): {
  done: number;
  total: number;
} {
  return {
    done: steps.filter((step) => step.status === 'done').length,
    total: steps.length,
  };
}

/**
 * A one-line answer to "whose move is it?" for the header. Returns `null` when
 * there is nothing outstanding.
 */
export function nextMoveLabel(
  steps: ContractStep[],
  counterpartyName: string,
): string | null {
  const step = currentStep(steps);
  if (!step) return null;
  switch (step.owner) {
    case 'you':
      return `Your move: ${step.label.toLowerCase()}`;
    case 'them':
      return `Waiting on ${counterpartyName}`;
    case 'both':
      return `Waiting on both of you: ${step.label.toLowerCase()}`;
    case 'platform':
      return step.label;
  }
}
