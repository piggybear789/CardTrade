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

/**
 * Member feedback (0120). Tighter than messaging, looser than auth.
 *
 * The table has no uniqueness rule to lean on — deliberately, because a member with
 * five separate bugs should be able to file five rows — so this is the only thing
 * standing between an annoyed member and a hundred rows. Five a minute is more than
 * anyone writing real feedback needs and far less than a script wants.
 */
export const feedbackLimiter = createRateLimiter({ prefix: 'feedback', limit: 5, window: '1m' });

/**
 * Behavioural instrumentation (0121). The loosest limiter here, by an order of magnitude.
 *
 * WHY SO HIGH. These are not member submissions; they are a by-product of using the app.
 * One navigation is one row, and a member clicking through a catalog, a listing, a
 * contract room and back spends four in a few seconds. A limit tuned like `feedbackLimiter`
 * would silently drop most of a real session and leave a funnel with holes in it — which is
 * worse than no funnel, because the holes are invisible and the chart still looks plausible.
 *
 * WHY THERE IS A LIMIT AT ALL. `ux_events` is insert-granted to every member JWT and has no
 * uniqueness rule, so without this one account could fill the largest table in the schema.
 * 120/minute is far more than any human generates and far less than a script wants.
 */
export const uxEventLimiter = createRateLimiter({ prefix: 'ux', limit: 120, window: '1m' });

/** General API / mobile routes. */
export const apiLimiter = createRateLimiter({ prefix: 'api', limit: 60, window: '1m' });
