// tests/unit/payeeNameMatch.test.ts — ESC-25: the payee is the verified person.

import { describe, expect, it } from 'vitest';

import {
  decidePayeeMatch,
  namesMatch,
  payeePairHash,
  splitFullName,
} from '@/domain/identity/payeeNameMatch';
import { canReceiveFunds, type MerchantRecord } from '@/domain/orchestrator/merchantOnboarding';

const SECRET = 's';
const id = { given: 'Mary Jane', family: "O'Néil" };

describe('namesMatch', () => {
  it('ignores case, diacritics, punctuation and hyphens', () => {
    expect(namesMatch(id, { given: 'MARY', family: 'oneil' })).toBe(true);
    expect(namesMatch({ given: 'Ann', family: 'Smith-Jones' }, { given: 'ann', family: 'Smith Jones' })).toBe(true);
  });
  it('accepts the first given name as a prefix either way', () => {
    expect(namesMatch(id, { given: 'Mary', family: "O'Neil" })).toBe(true);
    expect(namesMatch({ given: 'Mary', family: 'X' }, { given: 'Mary Jane', family: 'X' })).toBe(true);
  });
  it('a nickname or another family name is a mismatch', () => {
    expect(namesMatch({ given: 'Robert', family: 'Smith' }, { given: 'Bob', family: 'Smith' })).toBe(false);
    expect(namesMatch(id, { given: 'Mary', family: 'Smith' })).toBe(false);
  });
});

describe('decidePayeeMatch: all five outcomes', () => {
  it('MATCH, MISMATCH, SKIP, UNAVAILABLE, CLEARED', () => {
    const bob = { given: 'Bob', family: 'Smith' };
    const robert = { given: 'Robert', family: 'Smith' };
    expect(decidePayeeMatch({ identityName: robert, payeeName: robert, clearedPair: null, secret: SECRET })).toBe('MATCH');
    expect(decidePayeeMatch({ identityName: robert, payeeName: bob, clearedPair: null, secret: SECRET })).toBe('MISMATCH');
    expect(decidePayeeMatch({ identityName: null, payeeName: bob, clearedPair: null, secret: SECRET })).toBe('SKIP_NO_IDENTITY_NAME');
    expect(decidePayeeMatch({ identityName: robert, payeeName: null, clearedPair: null, secret: SECRET })).toBe('UNAVAILABLE');
    const cleared = payeePairHash(robert, bob, SECRET);
    expect(decidePayeeMatch({ identityName: robert, payeeName: bob, clearedPair: cleared, secret: SECRET })).toBe('CLEARED');
  });

  it('a cleared pair survives a refresh, and a changed payee name re-flags', () => {
    const robert = { given: 'Robert', family: 'Smith' };
    const cleared = payeePairHash(robert, { given: 'Bob', family: 'Smith' }, SECRET);
    expect(
      decidePayeeMatch({ identityName: robert, payeeName: { given: 'Bobby', family: 'Smith' }, clearedPair: cleared, secret: SECRET }),
    ).toBe('MISMATCH');
  });

  it('splitFullName takes the last word as the family name', () => {
    expect(splitFullName('Mary Jane Smith')).toEqual({ given: 'Mary Jane', family: 'Smith' });
    expect(splitFullName('Cher')).toBeNull();
  });
});

describe('canReceiveFunds', () => {
  it('is false while a payee mismatch is set', () => {
    const payable: MerchantRecord = {
      profileId: 'p',
      merchantRef: 'acct',
      merchantStatus: 'APPROVED',
      liveEnabled: true,
      transactionsEnabled: true,
      settlementsEnabled: true,
    };
    expect(canReceiveFunds(payable)).toBe(true);
    expect(canReceiveFunds({ ...payable, payeeIdentityMismatchAt: '2026-01-01T00:00:00.000Z' })).toBe(false);
  });
});
