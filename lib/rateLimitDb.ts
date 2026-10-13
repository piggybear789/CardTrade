// lib/rateLimitDb.ts
//
// A rate limit that holds across serverless instances (ESC-03 layer 4).
//
// `lib/rateLimit.ts` counts in process memory, so a burst spread over cold starts and
// regions is never counted as one: a stolen-card tester could add cards and attempt
// payments as fast as instances spin up. This one counts in Postgres through
// `cardtrade.consume_rate_limit` (0140, service role only).
//
// FAILS OPEN, deliberately, and logs once per failure. It is a brake on bursts, not a
// gate: a database hiccup must never stop an honest member paying. The refusal code is
// the existing `rate-limited`, so the member sees the same copy as every other limit.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { logBackgroundFailure } from '@/lib/errors/errorLog';

/** The guarded money paths and their per-member hourly limits (design ESC-03). */
export const DB_RATE_LIMITS = {
  beginCardSetup: { limit: 5, windowSeconds: 3_600 },
  acceptCashSaleTerms: { limit: 10, windowSeconds: 3_600 },
  createDealInvite: { limit: 10, windowSeconds: 3_600 },
  claimDealInvite: { limit: 10, windowSeconds: 3_600 },
  initiateCashSale: { limit: 20, windowSeconds: 3_600 },
} as const;

export type DbRateLimitName = keyof typeof DB_RATE_LIMITS;

/** The slice of the admin client this module calls. Injectable for tests. */
export interface RateLimitRpcClient {
  rpc(
    fn: 'consume_rate_limit',
    args: { p_key: string; p_limit: number; p_window_seconds: number },
  ): PromiseLike<{ data: boolean | null; error: { message: string } | null }>;
}

/**
 * Count one attempt for `memberId` on `name`. True while within the limit, and true
 * (logged) when the count could not be taken.
 */
export async function consumeDbRateLimit(
  name: DbRateLimitName,
  memberId: string,
  client: RateLimitRpcClient = createAdminClient() as unknown as RateLimitRpcClient,
): Promise<boolean> {
  const { limit, windowSeconds } = DB_RATE_LIMITS[name];
  try {
    const { data, error } = await client.rpc('consume_rate_limit', {
      p_key: `${name}:${memberId}`,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw new Error(error.message);
    return data !== false;
  } catch (error) {
    await logBackgroundFailure({
      name: 'ratelimit.db',
      errorCode: 'RATE_LIMIT_UNAVAILABLE',
      error,
      context: { limit: name },
    });
    return true;
  }
}
