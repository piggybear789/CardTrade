// Unit tests for Pathway declaration validation and tag generation
// (tests/e2e/audit/core/pathwayDeclaration.ts).
//
// Requirements: 4.4, 6.1, 29.1, 35.3

import { describe, expect, it } from 'vitest';

import {
  assertValidDeclaration,
  declarationProblems,
  mechanismAllowed,
  pathwayTags,
  recordDeclaration,
  type DeclarationInput,
} from '../../e2e/audit/core/pathwayDeclaration';

const valid: DeclarationInput = {
  id: 'cash-sale.pay.card-3ds',
  title: 'Buyer pays a cash sale by card with 3-D Secure',
  area: 'cash-sale',
  kind: 'happy',
  provider: 'stripe',
  members: { buyer: { email: 'bob@example.com', password: 'not-for-the-record' }, visitor: 'guest' },
  viewports: 'both',
};

describe('declarationProblems', () => {
  it('accepts a valid declaration', () => {
    expect(declarationProblems(valid)).toEqual([]);
    expect(() => assertValidDeclaration(valid)).not.toThrow();
  });

  it('refuses a malformed id', () => {
    for (const id of ['cash-sale', 'Cash-Sale.pay', 'cash sale.pay', '.cash-sale.pay', '']) {
      expect(declarationProblems({ ...valid, id }).join('\n')).toMatch(/id must be dotted lowercase/);
    }
  });

  it('refuses a mock Pathway with no mockReason, and a mockReason on a stripe one', () => {
    expect(declarationProblems({ ...valid, provider: 'mock' }).join('\n')).toMatch(/needs a written mockReason/);
    expect(declarationProblems({ ...valid, provider: 'mock', mockReason: '  ' }).join('\n')).toMatch(/mockReason/);
    expect(declarationProblems({ ...valid, provider: 'mock', mockReason: 'No real object can stand behind it.' })).toEqual([]);
    expect(declarationProblems({ ...valid, mockReason: 'x' }).join('\n')).toMatch(/only for provider "mock"/);
  });

  it('refuses viewports.only with no reason', () => {
    expect(declarationProblems({ ...valid, viewports: { only: 'phone', reason: '' } }).join('\n'))
      .toMatch(/viewports\.only needs a written reason/);
    expect(declarationProblems({ ...valid, viewports: { only: 'phone', reason: 'The hub bar is phone-only.' } })).toEqual([]);
  });

  it('refuses unknown areas, bad labels, suppressions without reasons and malformed findings', () => {
    const problems = declarationProblems({
      ...valid,
      area: 'nowhere' as DeclarationInput['area'],
      members: { Buyer: 'guest' },
      suppress: [{ check: 'cls', url: /\/sales\//, reason: '' }],
      knownFindings: ['21'],
    }).join('\n');
    expect(problems).toMatch(/unknown area/);
    expect(problems).toMatch(/invalid member label "Buyer"/);
    expect(problems).toMatch(/suppress\[0\] has no written reason/);
    expect(problems).toMatch(/known finding "21"/);
  });

  it('assertValidDeclaration lists every problem in one error', () => {
    expect(() => assertValidDeclaration({ ...valid, id: 'bad', provider: 'mock' })).toThrow(/id must be[\s\S]*mockReason/);
  });
});

describe('pathwayTags', () => {
  it('generates the id, area and kind tags', () => {
    expect(pathwayTags(valid)).toEqual(['@id:cash-sale.pay.card-3ds', '@area:cash-sale', '@kind:happy']);
  });

  it('adds @aux for a mock Pathway and @isolated when set', () => {
    expect(pathwayTags({ ...valid, kind: 'refusal', provider: 'mock', isolated: true })).toEqual([
      '@id:cash-sale.pay.card-3ds',
      '@area:cash-sale',
      '@kind:refusal',
      '@aux',
      '@isolated',
    ]);
  });
});

describe('mechanismAllowed', () => {
  it('allows the mock provider only in a mock Pathway', () => {
    expect(mechanismAllowed('mock-provider', 'stripe')).toBe(false);
    expect(mechanismAllowed('mock-provider', 'mock')).toBe(true);
    expect(mechanismAllowed('signed-fixture', 'stripe')).toBe(true);
    expect(mechanismAllowed('moved-timestamp', 'stripe')).toBe(true);
  });
});

describe('recordDeclaration', () => {
  it('describes members instead of copying them, and stores suppression sources', () => {
    const record = recordDeclaration(
      { ...valid, suppress: [{ check: 'cls', url: /\/sales\//, reason: 'Realtime row.' }] },
      (member) => (member === 'guest' ? 'guest' : 'seed:bob'),
    );
    expect(record.members).toEqual({ buyer: 'seed:bob', visitor: 'guest' });
    expect(JSON.stringify(record)).not.toContain('not-for-the-record');
    expect(record.suppress).toEqual([{ check: 'cls', url: '\\/sales\\/', reason: 'Realtime row.' }]);
  });
});
