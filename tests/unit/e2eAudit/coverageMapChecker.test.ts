/**
 * Examples for the Coverage_Map checks (e2e-ux-audit-suite, Req 5.1, 5.2, 5.4, 5.5, 5.6).
 * The guard over the real coverage.ts and product.md is a separate test.
 */
import { describe, expect, it } from 'vitest';
import {
  checkCoverageMap,
  extractProductFunctions,
  type CoverageEntry,
} from '../../e2e/audit/core/coverageMap';

const base = { area: 'auth' as const, function: 'Sign in' };

describe('extractProductFunctions', () => {
  it('reads ### headings from both sections and numbered models, in order', () => {
    const md = [
      '# Product',
      '## Surfaces',
      '### Not a function',
      '## Features and functionality',
      '### Auth',
      '1. **Welcome** — an onboarding step, not a model',
      '```',
      '### Inside a fence',
      '```',
      '### Offers',
      '## Transaction models',
      '1. **Cash Sale** — buyer pays.',
      '   1. **Indented** — not a model',
      '2. **2-Way Trade Escrow** — swap.',
      '### Return-conditional refunds',
      '## Current phase',
      '### Also not a function',
    ].join('\r\n');

    expect(extractProductFunctions(md)).toEqual([
      'Auth',
      'Offers',
      'Cash Sale',
      '2-Way Trade Escrow',
      'Return-conditional refunds',
    ]);
  });
});

describe('checkCoverageMap', () => {
  it('passes a complete map', () => {
    const entries: CoverageEntry[] = [
      { ...base, id: 'auth.sign-in', productSection: 'Auth', kind: 'automated', happy: ['auth.sign-in.ok'], refusal: ['auth.sign-in.bad'] },
      { ...base, id: 'auth.google-oauth', productSection: 'Auth', kind: 'out-of-scope', reason: 'Excluded by the owner.' },
      { ...base, id: 'notifications.email', productSection: 'Email', kind: 'manual', reason: 'SES inbox', manualCheck: 'Open the sandbox inbox.' },
    ];
    expect(checkCoverageMap(entries, ['Auth', 'Email'], ['auth.sign-in.ok', 'auth.sign-in.bad'])).toEqual([]);
  });

  it('reports every kind of defect, naming the entry', () => {
    const entries: CoverageEntry[] = [
      { ...base, id: 'a', productSection: 'Auth', kind: 'automated', happy: [], refusal: [] },
      { ...base, id: 'b', productSection: 'Auth', kind: 'automated', happy: ['x'], refusal: [] },
      { ...base, id: 'c', productSection: 'Auth', kind: 'manual', reason: 'r', manualCheck: ' ' },
      { ...base, id: 'c', productSection: 'Auth', kind: 'not-automated', reason: '' },
    ];
    const problems = checkCoverageMap(entries, ['Auth', 'Offers'], []);
    expect(problems.map((p) => [p.code, p.entryId ?? p.productFunction])).toEqual([
      ['duplicate-id', 'c'],
      ['no-mapping', 'a'],
      ['empty-refusal', 'b'],
      ['unknown-pathway', 'b'],
      ['manual-without-check', 'c'],
      ['no-mapping', 'c'],
      ['uncovered-function', 'Offers'],
    ]);
    expect(problems.every((p) => p.message.includes(p.entryId ?? p.productFunction ?? '\u0000'))).toBe(true);
  });
});
