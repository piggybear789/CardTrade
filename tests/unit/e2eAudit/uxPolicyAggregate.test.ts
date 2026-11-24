// tests/unit/e2eAudit/uxPolicyAggregate.test.ts
//
// Examples for the audit suite's observation policy and run aggregation (Req 4.7, 5.3,
// 6.2, 30.8, 30.9, 33.1, 33.6, 34.3). The universal properties (8 to 11) live in
// tests/property/e2eAudit/. The type assertions at the bottom pin the canonical records
// as structurally compatible with the report and findings input types.
import { describe, expect, it } from 'vitest';
import {
  aggregateRun,
  buildStepRecords,
  coverageStatus,
  pathwayStatus,
  type PathwayRecord,
  type RunManifest,
  type StepDraft,
  type StepRecord,
} from '../../e2e/audit/core/aggregate';
import type { CoverageEntry } from '../../e2e/audit/core/coverageMap';
import type { FindingPathway } from '../../e2e/audit/core/findings';
import type { ReportPathwayRecord, ReportRun } from '../../e2e/audit/core/html';
import {
  applySuppressions,
  BENIGN_CONSOLE,
  classifyObservation,
  type ClassifyContext,
  type Observation,
  type RawObservation,
} from '../../e2e/audit/core/uxPolicy';

const APP = 'http://localhost:3100';
const ctx = { appOrigin: APP };

function raw(check: RawObservation['check'], detail?: RawObservation['detail'], url = `${APP}/`): RawObservation {
  return { check, member: 'buyer', url, message: `${check} reading`, detail };
}

function severity(observation: RawObservation, context: ClassifyContext = ctx): string | undefined {
  return classifyObservation(observation, context)?.severity;
}

describe('classifyObservation', () => {
  it.each([
    ['cls', 'advisory'],
    ['shift-outside-region', 'advisory'],
    ['motion', 'advisory'],
    ['overflow', 'blocking'],
    ['skeleton', 'blocking'],
    ['toast', 'blocking'],
    ['unmasked', 'blocking'],
    ['copy-forbidden', 'blocking'],
    ['copy-shopfront', 'blocking'],
    ['copy-collateral', 'blocking'],
    ['copy-fee', 'blocking'],
  ] as const)('%s defaults to %s', (check, expected) => {
    expect(severity(raw(check))).toBe(expected);
  });

  it('splits accessibility by impact', () => {
    expect(severity(raw('a11y', { impact: 'critical' }))).toBe('blocking');
    expect(severity(raw('a11y', { impact: 'serious' }))).toBe('blocking');
    expect(severity(raw('a11y', { impact: 'moderate' }))).toBe('advisory');
    expect(severity(raw('a11y', { impact: 'minor' }))).toBe('advisory');
  });

  it('blocks page errors and app console errors, not third-party console', () => {
    expect(severity(raw('console', { kind: 'pageerror', sourceUrl: 'https://js.stripe.com/v3' }))).toBe('blocking');
    expect(severity(raw('console', { sourceUrl: `${APP}/_next/static/chunk.js` }))).toBe('blocking');
    expect(severity(raw('console'))).toBe('blocking');
    expect(severity(raw('console', { sourceUrl: 'https://js.stripe.com/v3' }))).toBe('advisory');
  });

  it('blocks 5xx and failed app requests; 4xx and third-party failures are advisory', () => {
    expect(severity(raw('network', { status: 502, requestUrl: `${APP}/api/x` }))).toBe('blocking');
    expect(severity(raw('network', { status: 404, requestUrl: `${APP}/api/x` }))).toBe('advisory');
    expect(severity(raw('network', { kind: 'requestfailed', requestUrl: `${APP}/api/x` }))).toBe('blocking');
    expect(severity(raw('network', { kind: 'requestfailed', requestUrl: 'https://m.stripe.network/b' }))).toBe('advisory');
  });

  it('blocks a currency figure without a code in contract rooms only', () => {
    expect(severity(raw('copy-currency', undefined, `${APP}/sales/abc`))).toBe('blocking');
    expect(severity(raw('copy-currency', undefined, `${APP}/trades/abc?tab=x`))).toBe('blocking');
    expect(severity(raw('copy-currency', undefined, `${APP}/sales`))).toBe('advisory');
    expect(severity(raw('copy-currency', undefined, `${APP}/`))).toBe('advisory');
    expect(severity(raw('copy-currency'), { ...ctx, moneySurface: 'contract' })).toBe('blocking');
    expect(severity(raw('copy-currency', undefined, `${APP}/sales/abc`), { ...ctx, moneySurface: 'browse' })).toBe('advisory');
  });

  it('drops BENIGN_CONSOLE messages and nothing else', () => {
    const benign = { ...raw('console'), message: `Warning: ${BENIGN_CONSOLE[0]} here` };
    expect(classifyObservation(benign, ctx)).toBeNull();
    expect(classifyObservation({ ...raw('a11y'), message: BENIGN_CONSOLE[0] }, ctx)).not.toBeNull();
  });

  it('defaults source to automated and keeps a reviewer source', () => {
    expect(classifyObservation(raw('overflow'), ctx)?.source).toBe('automated');
    expect(classifyObservation({ ...raw('overflow'), source: 'reviewer' }, ctx)?.source).toBe('reviewer');
  });

  it('throws on an unknown check', () => {
    expect(() => classifyObservation(raw('bogus' as never), ctx)).toThrow(/unknown UX check/);
  });
});

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    check: 'cls',
    severity: 'blocking',
    member: 'buyer',
    url: `${APP}/sales/1`,
    message: 'm',
    source: 'automated',
    ...overrides,
  };
}

describe('applySuppressions', () => {
  it('annotates matches and never drops anything', () => {
    const input = [observation(), observation({ check: 'overflow' }), observation({ url: `${APP}/` })];
    const out = applySuppressions(input, [{ check: 'cls', url: '/sales/', reason: 'room grows on load' }]);
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.suppressedBy)).toEqual(['room grows on load', undefined, undefined]);
    expect(input[0].suppressedBy).toBeUndefined();
  });

  it('refuses an invalid pattern or a blank reason', () => {
    expect(() => applySuppressions([], [{ check: 'cls', url: '(', reason: 'x' }])).toThrow(/invalid URL pattern/);
    expect(() => applySuppressions([], [{ check: 'cls', url: '.', reason: ' ' }])).toThrow(/no reason/);
  });
});

function draft(overrides: Partial<StepDraft> = {}): StepDraft {
  return {
    name: 'step',
    kind: 'action',
    members: ['buyer'],
    status: 'passed',
    startedAt: '2026-12-01T09:30:00.000Z',
    durationMs: 10,
    screenshots: [],
    observations: [],
    ...overrides,
  };
}

describe('buildStepRecords', () => {
  it('numbers steps densely and keeps simulated only on simulated steps', () => {
    const steps = buildStepRecords([
      draft({ name: 'a', simulated: { mechanism: 'signed-fixture' } }),
      draft({ name: 'b', kind: 'simulated', simulated: { mechanism: 'moved-timestamp', reason: 'r' } }),
      draft({ name: 'c', kind: 'arrange', status: 'failed' }),
    ]);
    expect(steps.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(steps.map((s) => s.name)).toEqual(['a', 'b', 'c']);
    expect(steps[0].simulated).toBeUndefined();
    expect(steps[1].simulated).toEqual({ mechanism: 'moved-timestamp', reason: 'r' });
    expect(steps[2].simulated).toBeUndefined();
  });

  it('throws on a simulated step without a mechanism', () => {
    expect(() => buildStepRecords([draft({ kind: 'simulated' })])).toThrow(/no valid mechanism/);
  });
});

describe('pathwayStatus', () => {
  const passing = { status: 'passed' as const, observations: [] as Observation[] };

  it('fails on a failed step or an unsuppressed blocking observation', () => {
    expect(pathwayStatus({ steps: [passing, { ...passing, status: 'failed' }], retries: 0 })).toBe('failed');
    expect(pathwayStatus({ steps: [{ ...passing, observations: [observation()] }], retries: 0 })).toBe('failed');
  });

  it('does not fail on advisory or suppressed observations', () => {
    const steps = [{ ...passing, observations: [observation({ severity: 'advisory' }), observation()] }];
    const suppressions = [{ check: 'cls' as const, url: '.', reason: 'known' }];
    expect(pathwayStatus({ steps, retries: 0, suppressions })).toBe('passed');
  });

  it('is flaky after a retry, skipped when skipped', () => {
    expect(pathwayStatus({ steps: [passing], retries: 1 })).toBe('flaky');
    expect(pathwayStatus({ steps: [], retries: 0, skipped: true })).toBe('skipped');
  });
});

const automated: CoverageEntry = {
  id: 'cash-sale.pay',
  area: 'cash-sale',
  function: 'Pay',
  productSection: 'Cash sales',
  kind: 'automated',
  happy: ['cash-sale.pay.card'],
  refusal: ['cash-sale.pay.refused'],
};

describe('coverageStatus', () => {
  const lookup = (map: Record<string, string>) => (id: string) => (map[id] ?? 'not-run') as never;

  it('follows its pathways on an automated entry', () => {
    expect(coverageStatus(automated, 'desktop', lookup({ 'cash-sale.pay.card': 'passed', 'cash-sale.pay.refused': 'flaky' }))).toBe('passing');
    expect(coverageStatus(automated, 'desktop', lookup({ 'cash-sale.pay.card': 'passed' }))).toBe('partly-run');
    expect(coverageStatus(automated, 'desktop', lookup({ 'cash-sale.pay.card': 'passed', 'cash-sale.pay.refused': 'failed' }))).toBe('failing');
    expect(coverageStatus(automated, 'desktop', lookup({ 'cash-sale.pay.card': 'skipped' }))).toBe('not-run');
  });

  it('keeps the kind of a non-automated entry', () => {
    const oauth: CoverageEntry = { ...automated, kind: 'out-of-scope', reason: 'Google OAuth' } as CoverageEntry;
    expect(coverageStatus(oauth, 'phone', lookup({}))).toBe('out-of-scope');
  });
});

function record(id: string, viewport: 'desktop' | 'phone', status: PathwayRecord['status'], steps: StepRecord[] = []): PathwayRecord {
  return {
    declaration: {
      id,
      title: id,
      area: 'cash-sale',
      kind: 'happy',
      provider: 'stripe',
      members: { buyer: 'guest' },
      viewports: 'both',
    },
    viewport,
    runId: '2026-12-01T09-30-00Z-a1b2c3d',
    status,
    retries: status === 'flaky' ? 1 : 0,
    steps,
    videos: [],
    forced: [],
    paymentsMode: 'stripe-test',
    simulated: steps.some((s) => s.kind === 'simulated'),
  };
}

function manifest(results: PathwayRecord[]): RunManifest {
  return {
    runId: '2026-12-01T09-30-00Z-a1b2c3d',
    startedAt: '2026-12-01T09:30:00.000Z',
    durationMs: 1000,
    commit: 'a1b2c3d',
    schema: 'cardtrade_dev',
    servers: [{ name: 'main', port: 3100, paymentsMode: 'stripe-test' }],
    results,
    leftInStripe: [],
  };
}

describe('aggregateRun', () => {
  it('lists every universe pathway, marks missing results not-run and totals them', () => {
    const steps = buildStepRecords([
      draft({ observations: [observation({ severity: 'advisory' })] }),
      draft({ kind: 'simulated', simulated: { mechanism: 'signed-fixture' } }),
    ]);
    const run = aggregateRun(
      manifest([
        record('cash-sale.pay.card', 'desktop', 'passed', steps),
        record('cash-sale.pay.card', 'phone', 'flaky'),
        record('stray.pathway', 'desktop', 'failed'),
      ]),
      [
        { id: 'cash-sale.pay.card', area: 'cash-sale' },
        { id: 'cash-sale.pay.refused', area: 'cash-sale' },
        { id: 'cash-sale.pay.card', area: 'journeys' },
      ],
      [automated],
    );

    expect(run.manifest).not.toHaveProperty('results');
    expect(run.pathways).toEqual([
      { id: 'cash-sale.pay.card', area: 'cash-sale', byViewport: { desktop: 'passed', phone: 'flaky' }, simulated: true, observationCount: 1 },
      { id: 'cash-sale.pay.refused', area: 'cash-sale', byViewport: { desktop: 'not-run', phone: 'not-run' }, simulated: false, observationCount: 0 },
    ]);
    expect(run.totals).toEqual({ passed: 1, failed: 0, flaky: 1, skipped: 0, 'not-run': 2 });
    expect(run.unmatchedResults).toEqual([{ id: 'stray.pathway', viewport: 'desktop' }]);
    expect(run.coverage[0].byViewport).toEqual({ desktop: 'partly-run', phone: 'partly-run' });
  });

  it('handles an empty run', () => {
    const run = aggregateRun(manifest([]), [{ id: 'auth.sign-in', area: 'auth' }]);
    expect(run.totals['not-run']).toBe(2);
    expect(run.coverage).toEqual([]);
  });

  it('produces values the report and findings modules accept as they are', () => {
    const rec = record('cash-sale.pay.card', 'desktop', 'passed', buildStepRecords([draft()]));
    const run = aggregateRun(manifest([rec]), [{ id: 'cash-sale.pay.card', area: 'cash-sale' }]);
    const asReport: ReportPathwayRecord = rec;
    const asFinding: FindingPathway = rec;
    const asRun: ReportRun = run;
    expect([asReport, asFinding, asRun]).toHaveLength(3);
  });
});
