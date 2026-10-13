// tests/unit/rateLimitDb.test.ts — ESC-03 layer 4: the cross-instance limiter fails open.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
const logged: unknown[] = [];
vi.mock('@/lib/errors/errorLog', () => ({
  logBackgroundFailure: async (entry: unknown) => {
    logged.push(entry);
  },
}));

import { consumeDbRateLimit, type RateLimitRpcClient } from '@/lib/rateLimitDb';

function client(result: { data: boolean | null; error: { message: string } | null }): RateLimitRpcClient & {
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    rpc: (_fn, args) => {
      calls.push(args);
      return Promise.resolve(result);
    },
  };
}

describe('consumeDbRateLimit', () => {
  beforeEach(() => {
    logged.length = 0;
  });

  it('allows within the limit and keys by action and member', async () => {
    const c = client({ data: true, error: null });
    expect(await consumeDbRateLimit('beginCardSetup', 'member-1', c)).toBe(true);
    expect(c.calls[0]).toEqual({ p_key: 'beginCardSetup:member-1', p_limit: 5, p_window_seconds: 3_600 });
  });

  it('refuses over the limit', async () => {
    expect(await consumeDbRateLimit('acceptCashSaleTerms', 'm', client({ data: false, error: null }))).toBe(false);
    expect(logged).toHaveLength(0);
  });

  it('a database error allows the call and logs once', async () => {
    expect(await consumeDbRateLimit('initiateCashSale', 'm', client({ data: null, error: { message: 'boom' } }))).toBe(true);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ name: 'ratelimit.db' });
  });
});
