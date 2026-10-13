// tests/unit/migrationHardening.test.ts
//
// Text guards for 0146 (ESC-36, evidence and attachment paths) and 0147 (ESC-39,
// default privileges), plus the webhook tolerance bound.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { webhookToleranceSeconds, DEFAULT_TOLERANCE_SECONDS } from '@/domain/services/stripe/webhook';

const read = (file: string) => readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8');

describe('0146 evidence path guards (ESC-36)', () => {
  const sql = read('0146_evidence_path_guards.sql');

  it('binds evidence to the author and attachments to the sender', () => {
    expect(sql).toContain("new.author_id::text || '/'");
    expect(sql).toContain("new.sender_id::text || '/'");
    expect(sql.match(/raise exception 'invalid-path'/g)?.length).toBe(3);
  });

  it('caps evidence at the TypeScript limit', async () => {
    const { MAX_EVIDENCE_FILES } = await import('@/lib/storage/disputeEvidence');
    const limit = /array_length\(new\.media_paths, 1\), 0\) > (\d+)/.exec(sql)?.[1];
    expect(Number(limit)).toBe(MAX_EVIDENCE_FILES);
  });
});

describe('0147 default privileges (ESC-39)', () => {
  it('revokes the default for the role that creates functions', () => {
    expect(read('0147_default_privileges_hardening.sql')).toMatch(
      /alter default privileges for role postgres in schema cardtrade\s+revoke execute on functions from public, anon, authenticated;/,
    );
  });
});

describe('webhookToleranceSeconds (ESC-39)', () => {
  it('honours a bounded value in seconds', () => {
    expect(webhookToleranceSeconds('120')).toBe(120);
  });

  it('falls back on anything out of range or unparseable', () => {
    expect(webhookToleranceSeconds(undefined)).toBe(DEFAULT_TOLERANCE_SECONDS);
    expect(webhookToleranceSeconds('0')).toBe(DEFAULT_TOLERANCE_SECONDS);
    expect(webhookToleranceSeconds('300000')).toBe(DEFAULT_TOLERANCE_SECONDS);
    expect(webhookToleranceSeconds('soon')).toBe(DEFAULT_TOLERANCE_SECONDS);
  });
});
