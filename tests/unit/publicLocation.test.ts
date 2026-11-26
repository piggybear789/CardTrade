import { describe, expect, it } from 'vitest';

import { publicLocationLabel } from '@/lib/location/publicLocation';

describe('publicLocationLabel', () => {
  it('drops the street, the postcode and the country', () => {
    expect(publicLocationLabel('12 Test Street, Sydney NSW 2000, Australia')).toBe('Sydney NSW');
    expect(publicLocationLabel('3/14 King St, Newtown NSW 2042, Australia')).toBe('Newtown NSW');
  });

  it('keeps a suburb label as it is, without the country', () => {
    expect(publicLocationLabel('Sydney NSW, Australia')).toBe('Sydney NSW');
    expect(publicLocationLabel('Berlin, Germany')).toBe('Berlin');
    expect(publicLocationLabel('Melbourne VIC')).toBe('Melbourne VIC');
  });

  it('is null for nothing usable', () => {
    expect(publicLocationLabel(null)).toBeNull();
    expect(publicLocationLabel('  ')).toBeNull();
  });
});
