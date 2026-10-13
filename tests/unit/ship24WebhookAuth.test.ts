// tests/unit/ship24WebhookAuth.test.ts
//
// ESC-39: the Ship24 secret travels in Authorization: Bearer. The query-string form
// is accepted only while SHIP24_WEBHOOK_ALLOW_QUERY_SECRET=true.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/errors/errorLog', () => ({ logBackgroundFailure: async () => undefined }));

const post = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });

describe('Ship24 webhook authentication', () => {
  beforeEach(() => {
    process.env.SHIP24_WEBHOOK_SECRET = 's3cret';
  });
  afterEach(() => {
    delete process.env.SHIP24_WEBHOOK_ALLOW_QUERY_SECRET;
  });

  it('accepts the secret as a Bearer token', async () => {
    const { POST } = await import('@/app/api/webhooks/ship24/route');
    const res = await POST(post('https://x.test/api/webhooks/ship24', { authorization: 'Bearer s3cret' }));
    expect(res.status).toBe(200);
  });

  it('refuses the query-string secret by default', async () => {
    const { POST } = await import('@/app/api/webhooks/ship24/route');
    const res = await POST(post('https://x.test/api/webhooks/ship24?token=s3cret'));
    expect(res.status).toBe(401);
  });

  it('accepts the query-string secret only behind the flag', async () => {
    process.env.SHIP24_WEBHOOK_ALLOW_QUERY_SECRET = 'true';
    const { POST } = await import('@/app/api/webhooks/ship24/route');
    const res = await POST(post('https://x.test/api/webhooks/ship24?token=s3cret'));
    expect(res.status).toBe(200);
  });

  it('refuses a wrong Bearer token', async () => {
    const { POST } = await import('@/app/api/webhooks/ship24/route');
    const res = await POST(post('https://x.test/api/webhooks/ship24', { authorization: 'Bearer nope' }));
    expect(res.status).toBe(401);
  });
});
