// tests/unit/transitionAuditFailure.test.ts
//
// R4-M1: a failed `trade_state_transitions` insert used to be discarded. Since the
// audit history decides NO_EXCHANGE, the repository now reports it through an injected
// `onAuditFailure` hook (domain stays log-free), and the committed state stands.

import { describe, expect, it, vi } from 'vitest';

import { createSupabaseTradeRepository } from '@/domain/orchestrator/supabaseTradeRepository';
import { createTradeOrchestrator } from '@/domain/orchestrator/tradeOrchestrator';

/** A minimal admin-client stand-in: a trade row, an optimistic update, a failing insert. */
function fakeClient() {
  const trade = { id: 'trade-1', state: 'INSPECTION', version: 3 };
  const inserts: unknown[] = [];

  const client = {
    from(table: string) {
      if (table === 'trades') {
        const filters: Record<string, unknown> = {};
        let patch: Record<string, unknown> | null = null;
        const chain = {
          select: () => chain,
          update: (values: Record<string, unknown>) => {
            patch = values;
            return chain;
          },
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return chain;
          },
          maybeSingle: async () => {
            if (patch) {
              if (filters.version !== trade.version) return { data: null, error: null };
              Object.assign(trade, patch);
            }
            return { data: { ...trade }, error: null };
          },
        };
        return chain;
      }
      if (table === 'trade_state_transitions') {
        return {
          insert: async (row: unknown) => {
            inserts.push(row);
            return { data: null, error: { message: 'insert denied', code: '42501' } };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, trade, inserts };
}

describe('insertTransition failure', () => {
  it('calls onAuditFailure once and leaves the committed state', async () => {
    const { client, trade, inserts } = fakeClient();
    const onAuditFailure = vi.fn();
    const repository = createSupabaseTradeRepository(client as never, { onAuditFailure });
    const orchestrator = createTradeOrchestrator({ repository });

    const result = await orchestrator.applyEvent({ tradeId: 'trade-1', event: 'CONDITION_DISPUTE', actorId: 'trader-a' });

    expect(result.ok).toBe(true);
    expect(trade).toMatchObject({ state: 'DISPUTED', version: 4 });
    expect(inserts).toHaveLength(1);
    expect(onAuditFailure).toHaveBeenCalledTimes(1);
    expect(onAuditFailure.mock.calls[0][0]).toMatchObject({
      tradeId: 'trade-1', fromState: 'INSPECTION', toState: 'DISPUTED', event: 'CONDITION_DISPUTE',
    });
    expect(onAuditFailure.mock.calls[0][1]).toMatchObject({ message: 'insert denied' });
  });

  it('does not call the hook when the insert succeeds', async () => {
    const { client } = fakeClient();
    const ok = {
      from(table: string) {
        if (table === 'trade_state_transitions') return { insert: async () => ({ data: null, error: null }) };
        return client.from(table);
      },
    };
    const onAuditFailure = vi.fn();
    const orchestrator = createTradeOrchestrator({
      repository: createSupabaseTradeRepository(ok as never, { onAuditFailure }),
    });
    await orchestrator.applyEvent({ tradeId: 'trade-1', event: 'CONDITION_DISPUTE', actorId: 'trader-a' });
    expect(onAuditFailure).not.toHaveBeenCalled();
  });
});
