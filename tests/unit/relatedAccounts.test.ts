// tests/unit/relatedAccounts.test.ts — ESC-03 layer 3: two accounts, one person.

import { describe, expect, it } from 'vitest';

import {
  EMPTY_SIGNALS,
  RELATED_ACCOUNTS_MESSAGE,
  areRelated,
  riskSignalHash,
} from '@/domain/risk/relatedAccounts';

const SECRET = 'test-secret';

describe('riskSignalHash', () => {
  it('is stable, kind-scoped, and never the raw value', () => {
    const card = riskSignalHash('CARD_FINGERPRINT', 'fp_abc', SECRET)!;
    expect(card).toBe(riskSignalHash('CARD_FINGERPRINT', 'fp_abc', SECRET));
    expect(card).not.toContain('fp_abc');
    expect(riskSignalHash('PAYOUT_ACCOUNT_FINGERPRINT', 'fp_abc', SECRET)).not.toBe(card);
  });

  it('records nothing without a secret or a value', () => {
    expect(riskSignalHash('CARD_FINGERPRINT', 'fp_abc', '')).toBeNull();
    expect(riskSignalHash('CARD_FINGERPRINT', ' ', SECRET)).toBeNull();
  });
});

describe('areRelated', () => {
  it('a shared card relates two accounts', () => {
    expect(areRelated({ ...EMPTY_SIGNALS, cardHashes: ['a', 'b'] }, { ...EMPTY_SIGNALS, cardHashes: ['b'] })).toBe(true);
  });
  it('a shared payout account relates them', () => {
    expect(areRelated({ ...EMPTY_SIGNALS, payoutHashes: ['x'] }, { ...EMPTY_SIGNALS, payoutHashes: ['x'] })).toBe(true);
  });
  it('a shared verified person relates them', () => {
    expect(areRelated({ ...EMPTY_SIGNALS, personKeys: ['p'] }, { ...EMPTY_SIGNALS, personKeys: ['p'] })).toBe(true);
  });
  it('a card hash never matches a payout hash', () => {
    expect(areRelated({ ...EMPTY_SIGNALS, cardHashes: ['x'] }, { ...EMPTY_SIGNALS, payoutHashes: ['x'] })).toBe(false);
  });
  it('nothing shared, or nothing known, is unrelated', () => {
    expect(areRelated({ ...EMPTY_SIGNALS, cardHashes: ['a'] }, { ...EMPTY_SIGNALS, cardHashes: ['b'] })).toBe(false);
    expect(areRelated(EMPTY_SIGNALS, EMPTY_SIGNALS)).toBe(false);
  });
  it('the refusal never says which signal matched', () => {
    expect(RELATED_ACCOUNTS_MESSAGE).not.toMatch(/card|bank|identity|payout/i);
  });
});
