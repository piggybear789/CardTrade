// domain/orchestrator/tradeOrchestrator.ts
//
// The guarded transition core of the Trade Orchestrator (Req 9).
//
// This module is the ONLY place that combines the pure state machine with
// persistence and payment side effects. To keep it exhaustively testable, it
// depends on *interfaces* (a `TradeRepository` for data access and the
// `PaymentService` for payment side effects) rather than the concrete Supabase
// admin client. Tasks 7.2/7.3 exercise `applyEvent` against the in-memory fake
// (task 6.4) by supplying those interfaces; the concrete Supabase binding lives
// in `supabaseTradeRepository.ts` so this file never imports `server-only`.
//
// Extension seams (intentionally left for later tasks):
// - `runSideEffects` is a pluggable hook. The default is a no-op; the full
//   payment side effects - hold placement/sizing (task 7.4) and dispute/fraud
//   captures/voids (task 7.8) - slot in by injecting a real `RunSideEffects`
//   implementation, with the injected `PaymentService` available on the context.
//
// All monetary amounts elsewhere in the system are integer AUD cents; this core
// deals only in states/versions and delegates money handling to the side-effect
// hook.

import { transition } from '../state-machine/machine';
import type { TradeEvent, TradeState } from '../state-machine/types';
import type { PaymentService } from '../services/types';

/**
 * The persisted Trade the orchestrator operates on. Only `id`, `state`, and
 * `version` are required by the guarded transition; the index signature carries
 * the remaining DB columns through so callers/side effects can read them without
 * this core needing to know the full row shape.
 */
export interface TradeRecord {
  id: string;
  state: TradeState;
  version: number;
  [column: string]: unknown;
}

/**
 * Typed failure codes returned by `applyEvent`.
 * - `TRADE_NOT_FOUND`         - no Trade exists for the given id.
 * - `INVALID_TRANSITION`      - the event is not valid from the current state;
 *                               the Trade is left unchanged (Req 9.2).
 * - `CONCURRENT_MODIFICATION` - another writer committed first; this attempt
 *                               lost the optimistic-lock race (Req 9.3, 9.4).
 * - `SIDE_EFFECT_FAILED`      - a payment side effect failed before commit; the
 *                               Trade is left unchanged.
 */
export type OrchestratorError =
  | 'TRADE_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'CONCURRENT_MODIFICATION'
  | 'SIDE_EFFECT_FAILED';

/**
 * Discriminated result of a guarded transition. On success the freshly
 * committed Trade row is returned; on failure a typed `error` (plus optional
 * human-readable `detail`) is returned and no mutation has occurred.
 */
export type ApplyEventResult =
  | { ok: true; trade: TradeRecord }
  | { ok: false; error: OrchestratorError; detail?: string };

/**
 * The append-only audit record written on every committed transition (Req 9.5):
 * the prior state, the new state, the requesting actor, the event, and a
 * timestamp.
 */
export interface TransitionAudit {
  tradeId: string;
  fromState: TradeState;
  toState: TradeState;
  requestedBy: string;
  event: TradeEvent;
  at: Date;
}

/** Parameters for the optimistic-lock commit. */
export interface CommitTransitionParams {
  tradeId: string;
  /** The version read at load time; the update only applies if it still matches. */
  expectedVersion: number;
  nextState: TradeState;
}

/**
 * Data-access seam for the orchestrator. Implemented by the Supabase admin
 * binding (`supabaseTradeRepository.ts`) in production and by an in-memory fake
 * (task 6.4) in tests.
 */
export interface TradeRepository {
  /** Load a Trade (including `state` + `version`), or `null` if it does not exist. */
  loadTrade(tradeId: string): Promise<TradeRecord | null>;
  /**
   * Commit the transition under an optimistic version lock: set
   * `state = nextState, version = expectedVersion + 1` only WHERE the row still
   * has `version = expectedVersion`. Returns the updated row on success, or
   * `null` when no row matched (a lost race - Req 9.3, 9.4).
   */
  commitTransition(params: CommitTransitionParams): Promise<TradeRecord | null>;
  /** Append an audit row for a committed transition (Req 9.5). */
  insertTransition(audit: TransitionAudit): Promise<void>;
}

/**
 * Context passed to the payment side-effect hook. `nextState` is the validated
 * target state; `payments` is the injected `PaymentService` the full side
 * effects (tasks 7.4/7.8) will drive. It is optional here because the default
 * no-op does not touch payments.
 */
export interface SideEffectContext {
  trade: TradeRecord;
  event: TradeEvent;
  nextState: TradeState;
  actorId: string;
  payments?: PaymentService;
}

/** Result of the side-effect hook: success, or failure with optional detail. */
export type SideEffectResult = { ok: true } | { ok: false; detail?: string };

/**
 * Pluggable payment side-effect hook. Runs AFTER the transition is validated
 * but BEFORE the state is committed, so a payment failure aborts the transition
 * without mutating the Trade. Tasks 7.4 (hold sizing/placement) and 7.8
 * (dispute/fraud captures/voids) replace the default no-op with concrete logic.
 */
export type RunSideEffects = (ctx: SideEffectContext) => Promise<SideEffectResult>;

/** Default side-effect hook: does nothing and always succeeds (placeholder seam). */
export const noopSideEffects: RunSideEffects = async () => ({ ok: true });

/** Dependencies injected into the orchestrator core. */
export interface TradeOrchestratorDeps {
  repository: TradeRepository;
  /** Injected so the full side effects (7.4/7.8) can drive payment operations. */
  payments?: PaymentService;
  /** Override the payment side-effect hook; defaults to {@link noopSideEffects}. */
  runSideEffects?: RunSideEffects;
  /** Clock seam for deterministic audit timestamps in tests; defaults to `Date`. */
  now?: () => Date;
}

/**
 * The guarded transition core (Req 9).
 *
 * Steps:
 * 1. Load the Trade (state + version). Missing -> `TRADE_NOT_FOUND`.
 * 2. Validate the event via the pure state machine. Invalid -> `INVALID_TRANSITION`
 *    with NO mutation (Req 9.2).
 * 3. Run payment side effects via the injected hook. Failure -> `SIDE_EFFECT_FAILED`
 *    with NO mutation.
 * 4. Commit under an optimistic version lock. Lost race -> `CONCURRENT_MODIFICATION`
 *    (Req 9.3, 9.4).
 * 5. Append the audit row (Req 9.5).
 *
 * Returns a discriminated `{ ok: true, trade } | { ok: false, error }`.
 */
export async function applyEvent(
  deps: TradeOrchestratorDeps,
  params: { tradeId: string; event: TradeEvent; actorId: string },
): Promise<ApplyEventResult> {
  const { repository } = deps;
  const runSideEffects = deps.runSideEffects ?? noopSideEffects;
  const now = deps.now ?? (() => new Date());

  // 1. Load the Trade including its current state + version.
  const trade = await repository.loadTrade(params.tradeId);
  if (!trade) {
    return { ok: false, error: 'TRADE_NOT_FOUND' };
  }

  // 2. Validate the requested event against the pure state machine. On an
  //    invalid transition we return immediately and never mutate (Req 9.2).
  const result = transition(trade.state, params.event);
  if (!result.ok || !result.nextState) {
    return { ok: false, error: 'INVALID_TRANSITION' };
  }
  const nextState = result.nextState;

  // 3. Run payment side effects for the event. A failure aborts the transition
  //    before any state is committed. (Full behavior lands in 7.4/7.8.)
  const sideEffect = await runSideEffects({
    trade,
    event: params.event,
    nextState,
    actorId: params.actorId,
    payments: deps.payments,
  });
  if (!sideEffect.ok) {
    return { ok: false, error: 'SIDE_EFFECT_FAILED', detail: sideEffect.detail };
  }

  // 4. Commit under an optimistic version lock. If no row matched the expected
  //    version, another writer won the race (Req 9.3, 9.4).
  const committed = await repository.commitTransition({
    tradeId: trade.id,
    expectedVersion: trade.version,
    nextState,
  });
  if (!committed) {
    return { ok: false, error: 'CONCURRENT_MODIFICATION' };
  }

  // 5. Append the immutable audit row for the committed transition (Req 9.5).
  await repository.insertTransition({
    tradeId: trade.id,
    fromState: trade.state,
    toState: nextState,
    requestedBy: params.actorId,
    event: params.event,
    at: now(),
  });

  return { ok: true, trade: committed };
}

/** A bound orchestrator: `applyEvent` with its dependencies already wired. */
export interface TradeOrchestrator {
  applyEvent(params: {
    tradeId: string;
    event: TradeEvent;
    actorId: string;
  }): Promise<ApplyEventResult>;
}

/**
 * Bind the guarded transition core to a set of dependencies. Tests wire an
 * in-memory fake repository + fake payment service here; production wires the
 * Supabase admin binding (see `supabaseTradeRepository.ts`).
 */
export function createTradeOrchestrator(deps: TradeOrchestratorDeps): TradeOrchestrator {
  return {
    applyEvent: (params) => applyEvent(deps, params),
  };
}
