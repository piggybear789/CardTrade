// tests/unit/e2eAudit/auditReporter.test.ts
//
// The audit reporter (tests/e2e/audit/reporter.ts): status from steps, Playwright's
// status and retries (a pass on retry is flaky, Req 34.3), tag-built records for
// Pathways that never attached one, scrubbing of everything written (Req 32.1), the
// manifest at its grammar path (Req 29.5, 33.3) and pruning of replaced run
// directories only (Req 29.6).

import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';

import type { PathwayRecord, RunManifest } from '../../e2e/audit/core/aggregate';
import AuditReporter, {
  buildManifest,
  recordForOutcome,
  scrubDeep,
  type TestOutcome,
} from '../../e2e/audit/reporter';

const RUN = '2026-12-01T09-30-00Z-abc1234';
const OLDER = '2026-11-30T09-30-00Z-old0001';

function record(overrides: Partial<PathwayRecord> = {}): PathwayRecord {
  return {
    declaration: {
      id: 'journeys.cash-sale-lifecycle',
      title: 'Cash sale lifecycle',
      area: 'journeys',
      kind: 'happy',
      provider: 'stripe',
      members: {},
      viewports: 'both',
    },
    viewport: 'desktop',
    runId: RUN,
    status: 'passed',
    retries: 0,
    steps: [{
      index: 1,
      name: 'Buyer pays',
      kind: 'action',
      members: ['buyer'],
      status: 'passed',
      startedAt: '2026-12-01T09:30:01.000Z',
      durationMs: 10,
      screenshots: [],
      observations: [],
    }],
    videos: [],
    forced: [],
    paymentsMode: 'stripe-test',
    simulated: false,
    ...overrides,
  };
}

function outcome(overrides: Partial<TestOutcome> = {}): TestOutcome {
  return {
    title: 'Cash sale lifecycle',
    projectName: 'desktop',
    tags: ['@id:journeys.cash-sale-lifecycle', '@area:journeys', '@kind:happy'],
    status: 'passed',
    retry: 0,
    attachment: JSON.stringify(record()),
    ...overrides,
  };
}

describe('recordForOutcome', () => {
  it('passes first time, and is flaky when it passed on a retry', () => {
    expect(recordForOutcome(outcome(), RUN)?.status).toBe('passed');
    const flaky = recordForOutcome(outcome({ retry: 1 }), RUN);
    expect(flaky?.status).toBe('flaky');
    expect(flaky?.retries).toBe(1);
  });

  it('fails on a failed step, and on a Playwright failure even when every step passed', () => {
    const failedStep = record();
    failedStep.steps[0].status = 'failed';
    expect(recordForOutcome(outcome({ attachment: JSON.stringify(failedStep) }), RUN)?.status).toBe('failed');
    expect(recordForOutcome(outcome({ status: 'timedOut' }), RUN)?.status).toBe('failed');
    expect(recordForOutcome(outcome({ status: 'failed', retry: 1 }), RUN)?.status).toBe('failed');
  });

  it('builds a record from the tags when no record was attached', () => {
    const skipped = recordForOutcome(
      outcome({ attachment: undefined, status: 'skipped', projectName: 'phone-aux', tags: ['@id:auth.rate-limit', '@area:auth', '@kind:refusal', '@aux'] }),
      RUN,
    );
    expect(skipped).toMatchObject({
      status: 'skipped',
      viewport: 'phone',
      paymentsMode: 'mock',
      declaration: { id: 'auth.rate-limit', area: 'auth', kind: 'refusal', provider: 'mock' },
    });
    expect(recordForOutcome(outcome({ attachment: undefined, status: 'failed' }), RUN)?.status).toBe('failed');
  });

  it('ignores a test that is not a Pathway', () => {
    expect(recordForOutcome(outcome({ attachment: undefined, tags: [] }), RUN)).toBeNull();
    expect(recordForOutcome(outcome({ attachment: '{"not":"a record"}', tags: [] }), RUN)).toBeNull();
  });
});

describe('buildManifest', () => {
  it('keeps one result per Pathway and viewport, sorted, with the run header', () => {
    const manifest = buildManifest(
      [outcome({ projectName: 'phone', attachment: JSON.stringify(record({ viewport: 'phone' })) }), outcome(), outcome({ retry: 1 })],
      { runId: RUN, startedAt: new Date('2026-12-01T09:30:00Z'), durationMs: 1234.4, commit: 'abc', servers: [] },
    );
    expect(manifest).toMatchObject({ runId: RUN, startedAt: '2026-12-01T09:30:00.000Z', durationMs: 1234, commit: 'abc', schema: 'cardtrade_dev', leftInStripe: [] });
    expect(manifest.results.map((r) => [r.viewport, r.status])).toEqual([['desktop', 'flaky'], ['phone', 'passed']]);
  });
});

describe('scrubDeep', () => {
  it('masks every string, nested and as keys', () => {
    const scrub = (text: string) => text.replaceAll('sk_test_secretvalue', '[MASKED]');
    expect(scrubDeep({ a: ['x sk_test_secretvalue'], sk_test_secretvalue: 1, n: 2 }, scrub)).toEqual({
      a: ['x [MASKED]'],
      '[MASKED]': 1,
      n: 2,
    });
  });
});

describe('AuditReporter', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function fakeTest(id: string, projectName: string, tags: string[]): TestCase {
    return { id, title: 'Cash sale lifecycle', tags, parent: { project: () => ({ name: projectName }) } } as unknown as TestCase;
  }

  function fakeResult(retry: number, status: TestResult['status'], body?: string): TestResult {
    return {
      retry,
      status,
      attachments: body === undefined ? [] : [{ name: 'audit-pathway', contentType: 'application/json', body: Buffer.from(body) }],
    } as unknown as TestResult;
  }

  it('writes a scrubbed manifest, keeps leftInStripe and prunes only replaced runs', async () => {
    root = mkdtempSync(path.join(tmpdir(), 'audit-reporter-'));
    const pairDir = path.join(root, 'audit-artifacts', 'journeys.cash-sale-lifecycle', 'desktop');
    mkdirSync(path.join(pairDir, OLDER), { recursive: true });
    mkdirSync(path.join(pairDir, RUN), { recursive: true });
    const otherPair = path.join(root, 'audit-artifacts', 'journeys.cash-sale-lifecycle', 'phone', OLDER);
    mkdirSync(otherPair, { recursive: true });
    const manifestFile = path.join(root, 'audit-artifacts', 'runs', RUN, 'manifest.json');
    mkdirSync(path.dirname(manifestFile), { recursive: true });
    const left = [{ type: 'payment_intent', id: 'pi_123', reason: 'already succeeded' }];
    writeFileSync(manifestFile, JSON.stringify({ leftInStripe: left }));

    const secret = 'sk_test_reporter_secret_value';
    const leaky = record();
    leaky.steps[0].error = `Stripe said ${secret} for alice@example.com`;

    const reporter = new AuditReporter({
      outputRoot: root,
      runId: RUN,
      commit: 'deadbeef',
      env: { STRIPE_SECRET_KEY: secret },
    });
    reporter.onBegin({ configFile: undefined, rootDir: root } as unknown as FullConfig, {} as Suite);
    const test = fakeTest('t1', 'desktop', ['@id:journeys.cash-sale-lifecycle', '@area:journeys']);
    reporter.onTestEnd(test, fakeResult(0, 'failed', JSON.stringify(leaky)));
    reporter.onTestEnd(test, fakeResult(1, 'passed', JSON.stringify(leaky)));
    reporter.onTestEnd(fakeTest('setup', 'setup', []), fakeResult(0, 'passed'));
    const outcome = await reporter.onEnd({ status: 'passed', startTime: new Date('2026-12-01T09:30:00Z'), duration: 5000 } as FullResult);

    expect(outcome).toBeUndefined();
    const text = readFileSync(manifestFile, 'utf8');
    expect(text).not.toContain(secret);
    expect(text).not.toContain('alice@example.com');
    const manifest = JSON.parse(text) as RunManifest;
    expect(manifest).toMatchObject({ runId: RUN, commit: 'deadbeef', durationMs: 5000, leftInStripe: left });
    expect(manifest.servers.map((s) => [s.name, s.port, s.paymentsMode])).toEqual([['main', 3100, 'stripe-test'], ['aux', 3101, 'mock']]);
    expect(manifest.results).toHaveLength(1);
    expect(manifest.results[0]).toMatchObject({ status: 'flaky', retries: 1 });

    expect(existsSync(path.join(pairDir, OLDER))).toBe(false);
    expect(existsSync(path.join(pairDir, RUN))).toBe(true);
    expect(existsSync(otherPair)).toBe(true);
  });
});
