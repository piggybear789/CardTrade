// tests/unit/dealCash.test.ts
//
// Private-deal cash settles through Pinch — never as physical cash at handover.

import { describe, expect, it } from 'vitest';

import {
  dealHasCashComponent,
  resolveDealCashSettlement,
} from '@/domain/deal/dealCash';

const CREATOR = 'creator-id';
const COUNTERPARTY = 'counterparty-id';

describe('dealHasCashComponent', () => {
  it('is true only for a positive cash amount', () => {
    expect(dealHasCashComponent(50_000)).toBe(true);
    expect(dealHasCashComponent(0)).toBe(false);
    expect(dealHasCashComponent(null)).toBe(false);
    expect(dealHasCashComponent(undefined)).toBe(false);
  });
});

describe('resolveDealCashSettlement', () => {
  it('returns null for goods-only deals', () => {
    expect(
      resolveDealCashSettlement({
        cashAmountCents: null,
        cashPayerId: CREATOR,
        creatorId: CREATOR,
        counterpartyId: COUNTERPARTY,
      }),
    ).toBeNull();
  });

  it('returns null while the counterparty has not joined', () => {
    expect(
      resolveDealCashSettlement({
        cashAmountCents: 50_000,
        cashPayerId: CREATOR,
        creatorId: CREATOR,
        counterpartyId: null,
      }),
    ).toBeNull();
  });

  it('returns null when the payer is missing or not a party', () => {
    expect(
      resolveDealCashSettlement({
        cashAmountCents: 50_000,
        cashPayerId: null,
        creatorId: CREATOR,
        counterpartyId: COUNTERPARTY,
      }),
    ).toBeNull();
    expect(
      resolveDealCashSettlement({
        cashAmountCents: 50_000,
        cashPayerId: 'stranger',
        creatorId: CREATOR,
        counterpartyId: COUNTERPARTY,
      }),
    ).toBeNull();
  });

  it('resolves payer and recipient for a BUYER-pays deal', () => {
    expect(
      resolveDealCashSettlement({
        cashAmountCents: 50_000,
        cashPayerId: CREATOR,
        creatorId: CREATOR,
        counterpartyId: COUNTERPARTY,
      }),
    ).toEqual({
      amountCents: 50_000,
      payerId: CREATOR,
      recipientId: COUNTERPARTY,
    });
  });

  it('resolves payer and recipient when the counterparty pays', () => {
    expect(
      resolveDealCashSettlement({
        cashAmountCents: 12_500,
        cashPayerId: COUNTERPARTY,
        creatorId: CREATOR,
        counterpartyId: COUNTERPARTY,
      }),
    ).toEqual({
      amountCents: 12_500,
      payerId: COUNTERPARTY,
      recipientId: CREATOR,
    });
  });
});
