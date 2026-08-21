import { describe, expect, it } from 'vitest';

import { identityFingerprints } from '@/domain/identity/identityFingerprint';

const SECRET = 'test-identity-fingerprint-secret';

describe('identityFingerprints', () => {
  it('hashes a government ID stably across spacing and case', () => {
    const a = identityFingerprints(
      { idNumber: 'ab 12-34', country: 'au' },
      SECRET,
    );
    const b = identityFingerprints(
      { idNumber: 'AB1234', country: 'AU' },
      SECRET,
    );

    expect(a).toHaveLength(1);
    expect(a[0]?.kind).toBe('document-id');
    expect(a[0]?.hash).toBe(b[0]?.hash);
    expect(a[0]?.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not collide different ID numbers', () => {
    const a = identityFingerprints({ idNumber: 'AAA111', country: 'AU' }, SECRET);
    const b = identityFingerprints({ idNumber: 'BBB222', country: 'AU' }, SECRET);
    expect(a[0]?.hash).not.toBe(b[0]?.hash);
  });

  it('emits a name-dob key as well so a second document still matches', () => {
    const prints = identityFingerprints(
      {
        idNumber: 'DL999',
        firstName: 'Phil',
        lastName: 'Yang',
        dob: { day: 1, month: 2, year: 1990 },
        country: 'AU',
      },
      SECRET,
    );

    expect(prints.map((p) => p.kind)).toEqual(['document-id', 'name-dob']);
    const dobOnly = identityFingerprints(
      {
        firstName: 'Phil',
        lastName: 'Yang',
        dob: { day: 1, month: 2, year: 1990 },
        country: 'AU',
      },
      SECRET,
    );
    expect(dobOnly).toHaveLength(1);
    expect(dobOnly[0]?.kind).toBe('name-dob');
    expect(dobOnly[0]?.hash).toBe(prints.find((p) => p.kind === 'name-dob')?.hash);
  });

  it('returns nothing without a secret or without usable fields', () => {
    expect(identityFingerprints({ idNumber: 'AAA' }, '')).toEqual([]);
    expect(identityFingerprints({ firstName: 'Phil' }, SECRET)).toEqual([]);
  });
});
