import { describe, expect, it } from 'vitest';

import { catalogSearchAttempts } from '@/lib/catalog/searchQuery';

describe('catalogSearchAttempts', () => {
  it('returns nothing for whitespace', () => {
    expect(catalogSearchAttempts('   ')).toEqual([]);
  });

  it('keeps a single token as-is', () => {
    expect(catalogSearchAttempts('Charizard')).toEqual(['Charizard']);
  });

  it('drops the leading product-line word so a player search still hits', () => {
    expect(catalogSearchAttempts('Iconic Michael Jordan')).toEqual([
      'Iconic Michael Jordan',
      'Michael Jordan',
      'Jordan',
    ]);
  });

  it('does not invent fallbacks for an explicit phrase', () => {
    expect(catalogSearchAttempts('"Michael Jordan"')).toEqual(['"Michael Jordan"']);
  });

  it('ignores stop words when building broader queries', () => {
    expect(catalogSearchAttempts('the Michael Jordan')).toEqual([
      'the Michael Jordan',
      'Michael Jordan',
      'Jordan',
    ]);
  });
});
