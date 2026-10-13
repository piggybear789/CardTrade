// tests/unit/errorsRouteOrigin.test.ts
//
// ESC-39: /api/errors refuses a cross-origin post, and an anonymous post with no
// Origin (a script, not a browser).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const user: { id: string } | null = null;
let currentUser: { id: string } | null = user;
const written: unknown[] = [];

vi.mock('@/lib/supabase/cachedAuth', () => ({ getCachedAuthUser: async () => currentUser }));
vi.mock('@/lib/rateLimiters', () => ({ errorLogLimiter: { check: async () => ({ allowed: true }) } }));
vi.mock('@/lib/rateLimit', () => ({ rateLimitIdentifier: async () => 'id' }));
vi.mock('@/lib/errors/errorLog', () => ({
  isErrorLoggingEnabled: () => true,
  writeErrorLog: async (row: unknown) => {
    written.push(row);
  },
}));

const body = JSON.stringify({ reference: 'abc123', message: 'boom', kind: 'uncaught' });
const post = (headers: Record<string, string>) =>
  new Request('https://noditto.app/api/errors', { method: 'POST', headers, body });

describe('/api/errors origin check', () => {
  beforeEach(() => {
    written.length = 0;
    currentUser = null;
  });

  it('refuses another site', async () => {
    const { POST } = await import('@/app/api/errors/route');
    expect((await POST(post({ origin: 'https://evil.example' }))).status).toBe(403);
  });

  it('refuses an anonymous post with no Origin', async () => {
    const { POST } = await import('@/app/api/errors/route');
    expect((await POST(post({}))).status).toBe(403);
  });

  it('accepts a same-origin post', async () => {
    const { POST } = await import('@/app/api/errors/route');
    expect((await POST(post({ origin: 'https://noditto.app' }))).status).toBe(204);
  });

  it('accepts a signed-in member with no Origin', async () => {
    currentUser = { id: 'member-1' };
    const { POST } = await import('@/app/api/errors/route');
    expect((await POST(post({}))).status).toBe(204);
  });
});
