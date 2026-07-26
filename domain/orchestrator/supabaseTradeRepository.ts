// domain/orchestrator/supabaseTradeRepository.ts
//
// The concrete, production wiring of the Trade Orchestrator's data-access seam.
// It backs the `TradeRepository` interface with the service-role Supabase admin
// client (which bypasses RLS — Trade writes must pass state-machine validation,
// trigger side effects, and write the audit row via this trusted path).
//
// This binding is kept OUT of `tradeOrchestrator.ts` on purpose: that core must
// stay importable by the domain tests (task 6.4 in-memory fake) without pulling
// in `server-only`/Supabase. Only this file carries the server-only dependency.

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  createTradeOrchestrator,
  type CommitTransitionParams,
  type TradeOrchestrator,
  type TradeOrchestratorDeps,
  type TradeRecord,
  type TradeRepository,
  type TransitionAudit,
} from './tradeOrchestrator';

/** The Supabase admin client type (service-role, RLS-bypassing). */
type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Build a {@link TradeRepository} backed by the Supabase admin client.
 *
 * - `loadTrade` reads the full Trade row (state + version + lifecycle fields).
 * - `commitTransition` performs the guarded write with an optimistic version
 *   lock: `.eq('version', expectedVersion)` ensures exactly one concurrent
 *   writer wins (Req 9.3). `.maybeSingle()` yields `null` when no row matched,
 *   which the core maps to `CONCURRENT_MODIFICATION` (Req 9.4).
 * - `insertTransition` appends the audit row (Req 9.5).
 */
export function createSupabaseTradeRepository(
  client: AdminClient = createAdminClient(),
): TradeRepository {
  return {
    async loadTrade(tradeId: string): Promise<TradeRecord | null> {
      const { data } = await client
        .from('trades')
        .select('*')
        .eq('id', tradeId)
        .maybeSingle();
      return (data as TradeRecord | null) ?? null;
    },

    async commitTransition({
      tradeId,
      expectedVersion,
      nextState,
    }: CommitTransitionParams): Promise<TradeRecord | null> {
      const { data } = await client
        .from('trades')
        .update({ state: nextState, version: expectedVersion + 1 })
        .eq('id', tradeId)
        .eq('version', expectedVersion) // optimistic lock -> exactly one winner
        .select('*')
        .maybeSingle();
      return (data as TradeRecord | null) ?? null;
    },

    async insertTransition(audit: TransitionAudit): Promise<void> {
      await client.from('trade_state_transitions').insert({
        trade_id: audit.tradeId,
        from_state: audit.fromState,
        to_state: audit.toState,
        requested_by: audit.requestedBy,
        event: audit.event,
        created_at: audit.at.toISOString(),
      });
    },
  };
}

/**
 * Default production orchestrator wiring: a Supabase-backed repository plus the
 * injectable seams for payments and side effects (left to tasks 7.4/7.8).
 *
 * Callers may override any dependency — e.g. supply a real `payments` service
 * and `runSideEffects` once the full side effects are implemented, or inject a
 * fake repository in an integration test.
 */
export function createDefaultTradeOrchestrator(
  overrides: Partial<TradeOrchestratorDeps> = {},
): TradeOrchestrator {
  return createTradeOrchestrator({
    repository: overrides.repository ?? createSupabaseTradeRepository(),
    payments: overrides.payments,
    runSideEffects: overrides.runSideEffects,
    now: overrides.now,
  });
}
