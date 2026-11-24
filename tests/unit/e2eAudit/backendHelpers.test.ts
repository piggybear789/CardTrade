// Unit tests for the pure parts of the audit suite's backend helpers
// (tests/e2e/audit/backend/{jobs,authLinks,seed}.ts). Nothing here reaches a server,
// the database or Stripe.
//
// Requirements: 2.1, 7.6, 7.7, 26.1, 26.2, 34.5

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { confirmUrl } from '../../e2e/audit/backend/authLinks';
import { JOB_SERVER_URL, jobRequest } from '../../e2e/audit/backend/jobs';
import {
  RESET_COMMAND,
  missingSeedMessage,
  personaEmail,
  personaProfileRow,
  seedRecordsFor,
} from '../../e2e/audit/backend/seed';
import { persona } from '../../e2e/support/users';

const SECRET = 'unit-test-jobs-secret';

describe('jobRequest', () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.JOBS_SECRET;
    process.env.JOBS_SECRET = SECRET;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.JOBS_SECRET;
    else process.env.JOBS_SECRET = previous;
  });

  const header = (init: RequestInit) => (init.headers as Record<string, string>).authorization;

  it('targets only the main server on localhost:3100', () => {
    expect(JOB_SERVER_URL).toBe('http://localhost:3100');
    expect(jobRequest('cash-sale-payouts').url).toBe('http://localhost:3100/api/jobs/cash-sale-payouts');
    expect(jobRequest('trade-inspections', 'correct', 'GET').init.method).toBe('GET');
  });

  it('sends the configured secret, none, or a wrong one', () => {
    expect(header(jobRequest('trade-inspections', 'correct').init)).toBe(`Bearer ${SECRET}`);
    expect(header(jobRequest('trade-inspections', 'missing').init)).toBeUndefined();
    const wrong = header(jobRequest('trade-inspections', 'wrong').init);
    expect(wrong).toMatch(/^Bearer /);
    expect(wrong).not.toContain(SECRET);
  });

  it('refuses a name that is not a job, and a missing secret', () => {
    expect(() => jobRequest('../webhooks/stripe')).toThrow(/refusing job call/);
    // Blank rather than deleted: `envValue` falls back to `.env.local` for an unset name.
    process.env.JOBS_SECRET = '';
    expect(() => jobRequest('cash-sale-payouts', 'correct')).toThrow(/JOBS_SECRET is not set/);
  });
});

describe('confirmUrl', () => {
  it('points at the App_Server /auth/confirm route with the hashed token', () => {
    const url = new URL(confirmUrl({ hashedToken: 'abc123', verificationType: 'recovery' }));
    expect(url.origin).toBe('http://localhost:3100');
    expect(url.pathname).toBe('/auth/confirm');
    expect(url.searchParams.get('token_hash')).toBe('abc123');
    expect(url.searchParams.get('type')).toBe('recovery');
    expect(new URL(confirmUrl({ hashedToken: 'x', verificationType: 'signup' }, 'aux')).port).toBe('3101');
  });
});

describe('seed records', () => {
  it('names the missing record and the reset command', () => {
    const message = missingSeedMessage(seedRecordsFor(['alice']));
    expect(message).toContain('"alice"');
    expect(message).toContain('11111111-1111-1111-1111-111111111111');
    expect(message).toContain(RESET_COMMAND);
    expect(RESET_COMMAND).toBe('npm run dev:db:reset');
  });

  it('refuses an unknown record name', () => {
    expect(() => seedRecordsFor(['mallory'])).toThrow(/unknown seed record/);
  });
});

describe('personas', () => {
  it('get a marked email that cleanup may delete', () => {
    expect(personaEmail('no-card-buyer')).toMatch(/^e2e-no-card-buyer-.+@example\.com$/);
    expect(personaEmail('x')).not.toBe(personaEmail('x'));
  });

  it('get a profile row in the state the spec names, and nothing more', () => {
    const now = new Date('2026-12-01T00:00:00.000Z');
    const plain = personaProfileRow(persona('no-card-buyer'), 'id-1', 'e@example.com', now);
    expect(plain).toEqual({
      id: 'id-1',
      display_name: '[E2E] no-card-buyer',
      contact_email: 'e@example.com',
      region_code: 'AU',
      onboarding_completed_at: now.toISOString(),
    });

    const verified = personaProfileRow(
      persona('gb-seller', { regionCode: 'gb', identityVerified: true, onboarded: false }),
      'id-2',
      'f@example.com',
      now,
    );
    expect(verified.region_code).toBe('GB');
    expect(verified.identity_check_status).toBe('VERIFIED');
    expect(verified).not.toHaveProperty('onboarding_completed_at');
  });
});
