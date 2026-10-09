import { describe, expect, it } from 'vitest';

import { displayLegalName } from '@/lib/format';

describe('displayLegalName', () => {
  it('sets an all-caps document name in normal case', () => {
    expect(displayLegalName('PHIL WILLIAM YANG')).toBe('Phil William Yang');
    expect(displayLegalName('PHIL')).toBe('Phil');
  });

  it('capitalises after hyphens and apostrophes', () => {
    expect(displayLegalName("MARY O'BRIEN-SMITH")).toBe("Mary O'Brien-Smith");
  });

  it('leaves a mixed-case name exactly as given', () => {
    expect(displayLegalName('Ada McDonald')).toBe('Ada McDonald');
    expect(displayLegalName('van der Berg')).toBe('van der Berg');
  });

  it('returns null for an empty name', () => {
    expect(displayLegalName('  ')).toBeNull();
    expect(displayLegalName(null)).toBeNull();
  });
});
