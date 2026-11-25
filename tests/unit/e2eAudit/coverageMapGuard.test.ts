// tests/unit/e2eAudit/coverageMapGuard.test.ts
//
// Guards the real Coverage_Map (`tests/e2e/audit/coverage.ts`) against
// `.kiro/steering/product.md` and the Pathway specs (`tests/e2e/specs/**`).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkCoverageMap, extractProductFunctions } from '../../e2e/audit/core/coverageMap';
import { COVERAGE_MAP } from '../../e2e/audit/coverage';
import { HIGHLIGHT_SELECTION } from '../../e2e/audit/highlights';
import { pathwayIdsInSpecs } from '../../e2e/audit/pathwayUniverse';

const ROOT = path.resolve(__dirname, '..', '..', '..');

describe('real Coverage_Map', () => {
  const productMd = readFileSync(path.join(ROOT, '.kiro', 'steering', 'product.md'), 'utf8');
  const productFunctions = extractProductFunctions(productMd);
  const definedIds = pathwayIdsInSpecs(ROOT);

  it('passes checkCoverageMap with zero defects', () => {
    const problems = checkCoverageMap(COVERAGE_MAP, productFunctions, definedIds);
    expect(problems).toEqual([]);
  });

  it('marks Google OAuth as out-of-scope', () => {
    const oauth = COVERAGE_MAP.find((e) => e.id === 'auth.google-oauth');
    expect(oauth?.kind).toBe('out-of-scope');
  });

  it('every supersededProbes entry refers to a probe in tests/e2e/debug/', () => {
    for (const entry of COVERAGE_MAP) {
      for (const probe of entry.supersededProbes ?? []) {
        const file = path.join(ROOT, 'tests', 'e2e', 'debug', `${probe}.spec.ts`);
        expect(existsSync(file), `Missing superseded probe: ${file}`).toBe(true);
      }
    }
  });

  it('highlight reel selection starts with the two lifecycle journeys and exists in universe', () => {
    expect(HIGHLIGHT_SELECTION.slice(0, 2)).toEqual([
      'journeys.cash-sale-lifecycle',
      'journeys.trade-lifecycle',
    ]);
    for (const id of HIGHLIGHT_SELECTION) {
      expect(definedIds).toContain(id);
    }
  });
});
