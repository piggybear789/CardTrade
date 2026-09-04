import 'server-only';

// lib/rateLimiters.ts
//
// Pre-configured rate limiters for the app's key action boundaries.
// Import the one you need in a server action and call `.check(identifier)`.

import { createRateLimiter } from '@/lib/rateLimit';

/**
 * Sign-ins allowed per identifier per minute.
 *
 * FIVE IN PRODUCTION, AND THE ENV VAR EXISTS FOR ONE CALLER. The e2e suite signs
 * seven seeded members in from a single address during setup, so the last two
 * are refused by a correctly-working limiter and the entire run fails before a
 * spec executes. `playwright.config.ts` raises it for its own server only, the
 * same way that server already overrides `PAYMENTS_PROVIDER` and the Maps key.
 *
 * Deliberately an override with a safe default rather than a looser limit: an
 * unset or unparseable value keeps production at 5, so forgetting to set it
 * anywhere cannot widen the limit on the app's most attacked endpoint.
 */
const AUTH_ATTEMPTS_PER_MINUTE = (() => {
  const raw = Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(raw) && raw > 0 ? raw : 5;
})();

/** Auth actions: sign-in, sign-up, password reset. Tight window. */
export const authLimiter = createRateLimiter({
  prefix: 'auth',
  limit: AUTH_ATTEMPTS_PER_MINUTE,
  window: '1m',
});

/** Listing creation / edit. Moderate. */
export const listingLimiter = createRateLimiter({ prefix: 'listing', limit: 10, window: '1m' });

/** Trade / cash sale initiation. Moderate. */
export const contractLimiter = createRateLimiter({ prefix: 'contract', limit: 10, window: '1m' });

/** Messaging. More permissive but still bounded. */
export const messageLimiter = createRateLimiter({ prefix: 'message', limit: 30, window: '1m' });

/** General API / mobile routes. */
export const apiLimiter = createRateLimiter({ prefix: 'api', limit: 60, window: '1m' });
