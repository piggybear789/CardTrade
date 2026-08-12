import 'server-only';

// lib/rateLimit.ts
//
// Lightweight in-memory rate-limiting for Server Actions and API routes.
// Sliding window per identifier, reset on cold start. Sufficient for a single
// deployment instance; for distributed limiting across many instances, swap the
// store for Redis later.
//
// Best-effort: never throws into the caller's path.
//
// Usage:
//   const limiter = createRateLimiter({ prefix: 'auth', limit: 5, window: '1m' });
//   const { allowed } = await limiter.check(userId);
//   if (!allowed) return fail('rate-limited', 'Too many attempts. Try again shortly.');

import { headers } from 'next/headers';

/** Rate limiter configuration. */
export interface RateLimitConfig {
  /** Namespace prefix to separate different limiters. */
  prefix: string;
  /** Maximum requests allowed in the window. */
  limit: number;
  /** Window duration, e.g. '1m', '10s', '1h'. */
  window: string;
}

/** Result of a rate limit check. */
export interface RateLimitResult {
  allowed: boolean;
  /** Remaining requests in the current window. */
  remaining: number;
}

// In-memory sliding window store. Entries expire on next check after their
// window passes. Not shared across instances or cold starts — that is an
// accepted trade-off for zero external dependencies.
const store = new Map<string, { count: number; resetAt: number }>();

function parseWindow(window: string): number {
  const match = window.match(/^(\d+)([smh])$/);
  if (!match) return 60_000; // default 1 minute
  const [, num, unit] = match;
  const ms = { s: 1000, m: 60_000, h: 3_600_000 }[unit!] ?? 60_000;
  return Number(num) * ms;
}

/**
 * Create a rate limiter instance. Pure in-memory sliding window.
 */
export function createRateLimiter(config: RateLimitConfig) {
  const windowMs = parseWindow(config.window);

  return {
    /**
     * Check whether `identifier` is within the rate limit.
     */
    async check(identifier: string): Promise<RateLimitResult> {
      const key = `${config.prefix}:${identifier}`;
      const now = Date.now();
      const entry = store.get(key);

      if (!entry || now > entry.resetAt) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: config.limit - 1 };
      }

      entry.count += 1;
      if (entry.count > config.limit) {
        return { allowed: false, remaining: 0 };
      }
      return { allowed: true, remaining: config.limit - entry.count };
    },
  };
}

/**
 * Resolve a stable identifier for the current request. Prefers the authenticated
 * user id when available, falls back to IP address.
 */
export async function rateLimitIdentifier(userId?: string | null): Promise<string> {
  if (userId) return `user:${userId}`;
  const hdrs = await headers();
  const forwarded = hdrs.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? hdrs.get('x-real-ip') ?? 'unknown';
  return `ip:${ip}`;
}
