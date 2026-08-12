import 'server-only';

// lib/rateLimiters.ts
//
// Pre-configured rate limiters for the app's key action boundaries.
// Import the one you need in a server action and call `.check(identifier)`.

import { createRateLimiter } from '@/lib/rateLimit';

/** Auth actions: sign-in, sign-up, password reset. Tight window. */
export const authLimiter = createRateLimiter({ prefix: 'auth', limit: 5, window: '1m' });

/** Listing creation / edit. Moderate. */
export const listingLimiter = createRateLimiter({ prefix: 'listing', limit: 10, window: '1m' });

/** Trade / cash sale initiation. Moderate. */
export const contractLimiter = createRateLimiter({ prefix: 'contract', limit: 10, window: '1m' });

/** Messaging. More permissive but still bounded. */
export const messageLimiter = createRateLimiter({ prefix: 'message', limit: 30, window: '1m' });

/** General API / mobile routes. */
export const apiLimiter = createRateLimiter({ prefix: 'api', limit: 60, window: '1m' });
