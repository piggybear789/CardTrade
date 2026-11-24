// Examples for the Pathway universe parsers (e2e-ux-audit-suite, design "Coverage_Map").
// Requirements: 5.4

import { describe, expect, it } from 'vitest';

import {
  pathwayIdsFromListJson,
  pathwayIdsFromSource,
} from '../../e2e/audit/pathwayUniverse';

describe('pathwayIdsFromListJson', () => {
  it('collects @id tags from nested suites once, whatever the project count', () => {
    const report = {
      config: {},
      suites: [
        {
          title: 'cash-sale.spec.ts',
          specs: [
            { title: 'Buyer pays by card', tags: ['@id:cash-sale.pay.card', '@area:cash-sale'] },
            { title: 'Buyer pays by card', tags: ['@id:cash-sale.pay.card'] },
          ],
          suites: [{ title: 'nested', specs: [{ title: 'Refused @id:cash-sale.refuse.no-card', tags: [] }] }],
        },
      ],
    };
    expect(pathwayIdsFromListJson(JSON.stringify(report))).toEqual([
      'cash-sale.pay.card',
      'cash-sale.refuse.no-card',
    ]);
  });

  it('accepts tags written without the @ and ignores "id:" inside ordinary words', () => {
    const report = { suites: [{ specs: [{ title: 'Valid: the form', tags: ['id:auth.sign-in'] }] }] };
    expect(pathwayIdsFromListJson(JSON.stringify(report))).toEqual(['auth.sign-in']);
  });

  it('throws on text that is not JSON instead of returning an empty universe', () => {
    expect(() => pathwayIdsFromListJson('Listing tests:')).toThrow();
  });
});

describe('pathwayIdsFromSource', () => {
  it('reads pathway({ id }) literals in either quote style', () => {
    const source = [
      "pathway({ id: 'trades.lock.collateral', title: 'x' }, async () => {});",
      'pathway(\n  {\n    id: "trades.refuse.no-card",\n  },\n  async () => {},\n);',
      "const notAPathway = { id: 'ignored' };",
    ].join('\n');
    expect(pathwayIdsFromSource(source)).toEqual(['trades.lock.collateral', 'trades.refuse.no-card']);
  });
});
