// tests/unit/e2eAudit/auditArgs.test.ts
//
// Argument translation in scripts/e2e/audit.mjs (task 7.21): `--area`, `--pathway`,
// `--viewport`, `--no-build` and passthrough become the right grep, project and step
// arguments. Pure functions only; nothing is spawned.
//
// Requirements: 35.3

import { describe, expect, it } from 'vitest';
import {
  AuditUsageError,
  grepFor,
  parseAuditArgs,
  planSteps,
  playwrightTestArgs,
} from '../../../scripts/e2e/audit.mjs';
import { AREAS } from '../../e2e/audit/core/coverageMap';

const known = { areas: AREAS };

/** The title-path-plus-tags string Playwright matches `--grep` against. */
function matches(grep: string, tags: string): boolean {
  return new RegExp(grep, 'i').test(`chromium cash-sale.spec.ts Buy a card ${tags}`);
}

describe('parseAuditArgs', () => {
  it('defaults to the whole suite with a build', () => {
    const options = parseAuditArgs([], known);
    expect(options).toMatchObject({ build: true, dryRun: false, areas: [], pathways: [], viewport: null, passthrough: [] });
    expect(playwrightTestArgs(options)).toEqual([]);
  });

  it('accepts space and = forms, and repeats', () => {
    const options = parseAuditArgs(
      ['--area', 'cash-sale', '--area=trades', '--pathway', 'offers.counter', '--viewport=phone'],
      known,
    );
    expect(options.areas).toEqual(['cash-sale', 'trades']);
    expect(options.pathways).toEqual(['offers.counter']);
    expect(options.viewport).toBe('phone');
  });

  it('refuses unknown areas, malformed ids, bad viewports and unknown flags', () => {
    expect(() => parseAuditArgs(['--area', 'payments'], known)).toThrow(AuditUsageError);
    expect(() => parseAuditArgs(['--pathway', 'Cash Sale'], known)).toThrow(AuditUsageError);
    expect(() => parseAuditArgs(['--pathway', 'nodot'], known)).toThrow(AuditUsageError);
    expect(() => parseAuditArgs(['--viewport', 'tablet'], known)).toThrow(AuditUsageError);
    expect(() => parseAuditArgs(['--area'], known)).toThrow(AuditUsageError);
    expect(() => parseAuditArgs(['--area', '--no-build'], known)).toThrow(AuditUsageError);
    expect(() => parseAuditArgs(['--headed'], known)).toThrow(AuditUsageError);
  });

  it('passes everything after -- through unchanged, after its own arguments', () => {
    const options = parseAuditArgs(['--viewport', 'desktop', '--', '--headed', '--area', 'x'], known);
    expect(options.areas).toEqual([]);
    expect(playwrightTestArgs(options)).toEqual([
      '--project=desktop',
      '--project=desktop-aux',
      '--headed',
      '--area',
      'x',
    ]);
  });
});

describe('grepFor', () => {
  it('is null for the whole suite', () => {
    expect(grepFor({ areas: [], pathways: [] })).toBeNull();
  });

  it('selects an area tag without selecting a longer area', () => {
    const grep = grepFor({ areas: ['cash-sale'], pathways: [] })!;
    expect(matches(grep, '@id:cash-sale.pay @area:cash-sale @kind:happy')).toBe(true);
    expect(matches(grep, '@area:cash-sale')).toBe(true);
    expect(matches(grep, '@id:cash-sale-disputes.raise @area:cash-sale-disputes @kind:happy')).toBe(false);
  });

  it('selects an exact Pathway id, with dots matched literally', () => {
    const grep = grepFor({ areas: [], pathways: ['cash-sale.pay'] })!;
    expect(matches(grep, '@id:cash-sale.pay @area:cash-sale')).toBe(true);
    expect(matches(grep, '@id:cash-sale.pay-by-bank @area:cash-sale')).toBe(false);
    expect(matches(grep, '@id:cash-saleXpay @area:cash-sale')).toBe(false);
  });

  it('selects the union of areas and Pathways', () => {
    const grep = grepFor({ areas: ['offers'], pathways: ['trades.propose'] })!;
    expect(matches(grep, '@id:offers.counter @area:offers')).toBe(true);
    expect(matches(grep, '@id:trades.propose @area:trades')).toBe(true);
    expect(matches(grep, '@id:trades.accept @area:trades')).toBe(false);
  });
});

describe('planSteps', () => {
  const names = (steps: Array<{ name: string }>) => steps.map((step) => step.name);

  it('runs preflight, build, stamp check, list, test and report in order', () => {
    const steps = planSteps(parseAuditArgs([], known), { reportExists: true });
    expect(names(steps)).toEqual([
      'static preflight',
      'build',
      'client env stamp check',
      'list pathways',
      'playwright test',
      'report',
    ]);
  });

  it('--no-build drops only the build; the stamp is still checked', () => {
    const steps = planSteps(parseAuditArgs(['--no-build'], known));
    expect(names(steps)).toEqual(['static preflight', 'client env stamp check', 'list pathways', 'playwright test']);
  });

  it('lists the whole suite even when the run is a subset', () => {
    const steps = planSteps(parseAuditArgs(['--area', 'offers', '--viewport', 'phone'], known));
    const list = steps.find((step) => step.name === 'list pathways') as unknown as { args: string[]; stdoutTo: string };
    expect(list.args.slice(1)).toEqual(['test', '--list', '--reporter=json']);
    expect(list.stdoutTo.replace(/\\/g, '/')).toBe('audit-artifacts/.pathways.json');
    const run = steps.find((step) => step.name === 'playwright test') as unknown as { args: string[] };
    expect(run.args.slice(1)).toEqual(['test', ...playwrightTestArgs(parseAuditArgs(['--area', 'offers', '--viewport', 'phone'], known))]);
    expect(run.args).toContain('--project=phone');
  });
});
