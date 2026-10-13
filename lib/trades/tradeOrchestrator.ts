// lib/trades/tradeOrchestrator.ts
//
// The trade orchestrator every lib call site builds, with a failed audit insert
// LOGGED rather than discarded (R4-M1).
//
// `trade_state_transitions` used to be written with the returned `{ error }` ignored,
// so a committed transition could have no history row and nobody would know. Since
// ESC-01 that history decides money: NO_EXCHANGE is only allowed on a trade that never
// reached INSPECTION. The repository now reports a failed insert through an injected
// `onAuditFailure` hook (domain stays log-free), and this wrapper binds the hook to
// `logBackgroundFailure`. The committed state is never undone.
//
// `server-only`, not a Server Action: building an orchestrator is not an endpoint.

import 'server-only';

import { createDefaultTradeOrchestrator } from '@/domain/orchestrator/supabaseTradeRepository';
import type { TradeOrchestrator } from '@/domain/orchestrator/tradeOrchestrator';
import { logBackgroundFailure } from '@/lib/errors/errorLog';

/**
 * `createDefaultTradeOrchestrator` with `onAuditFailure` wired to the error log as
 * `trade.transition_audit` / `TRANSITION_AUDIT_FAILED` (unexpected), ids only.
 */
export function createLoggedTradeOrchestrator(
  overrides: Parameters<typeof createDefaultTradeOrchestrator>[0] = {},
): TradeOrchestrator {
  return createDefaultTradeOrchestrator({
    ...overrides,
    onAuditFailure: (audit, error) => {
      overrides.onAuditFailure?.(audit, error);
      void logBackgroundFailure({
        name: 'trade.transition_audit',
        errorCode: 'TRANSITION_AUDIT_FAILED',
        message: `Audit row for ${audit.event} (${audit.fromState} -> ${audit.toState}) was not written: ${error.message}`,
        context: { tradeId: audit.tradeId },
      }).catch(() => undefined);
    },
  });
}
