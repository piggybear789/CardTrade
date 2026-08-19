// tests/unit/dealInvite.test.ts
//
// Pure guards for a private-deal invite: status, cash price, wanted copy,
// hidden-item attachment, and who puts up a card on claim.

import { describe, expect, it } from 'vitest';

import {
  cashDealParties,
  cashPriceProblem,
  dollarsToCents,
  inviteStatus,
  joinerPutsUpACard,
  privateItemProblem,
  wantedDescriptionProblem,
} from '@/domain/deals/dealInvite';
import { DEAL_CASH_MAX } from '@/lib/marketplace-constants';

describe('dollarsToCents', () => {
  it('parses a dollar string to integer cents', () => {
    expect(dollarsToCents('40.00')).toBe(4000);
    expect(dollarsToCents('0.01')).toBe(1);
    expect(dollarsToCents('40000')).toBe(4_000_000);
  });

  it('returns null for blank or invalid input', () => {
    expect(dollarsToCents('')).toBeNull();
    expect(dollarsToCents('nope')).toBeNull();
    expect(dollarsToCents('-1')).toBeNull();
  });
});

describe('inviteStatus', () => {
  const later = new Date('2026-02-01T00:00:00.000Z');
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('is open when unused and unexpired', () => {
    expect(
      inviteStatus({
        expiresAt: later.toISOString(),
        revokedAt: null,
        claimedAt: null,
        now,
      }),
    ).toBe('open');
  });

  it('prefers claimed over expiry or revoke', () => {
    expect(
      inviteStatus({
        expiresAt: later.toISOString(),
        revokedAt: now.toISOString(),
        claimedAt: now.toISOString(),
        now,
      }),
    ).toBe('claimed');
  });

  it('is revoked when cancelled unused', () => {
    expect(
      inviteStatus({
        expiresAt: later.toISOString(),
        revokedAt: now.toISOString(),
        claimedAt: null,
        now,
      }),
    ).toBe('revoked');
  });

  it('is expired at or after expires_at', () => {
    expect(
      inviteStatus({
        expiresAt: now.toISOString(),
        revokedAt: null,
        claimedAt: null,
        now,
      }),
    ).toBe('expired');
  });
});

describe('cashPriceProblem', () => {
  it('requires an integer price in platform bounds', () => {
    expect(cashPriceProblem(null)).toBeTruthy();
    expect(cashPriceProblem(1.5)).toBeTruthy();
    expect(cashPriceProblem(0)).toBeTruthy();
    expect(cashPriceProblem(DEAL_CASH_MAX + 1)).toBeTruthy();
    expect(cashPriceProblem(1)).toBeNull();
    expect(cashPriceProblem(4_000_000)).toBeNull();
  });
});

describe('wantedDescriptionProblem', () => {
  it('requires copy when the host did not bring a card', () => {
    expect(wantedDescriptionProblem('', true)).toBeTruthy();
    expect(wantedDescriptionProblem('  Charizard  ', true)).toBeNull();
    expect(wantedDescriptionProblem('', false)).toBeNull();
  });
});

describe('privateItemProblem', () => {
  const item = { hidden: true, ownerId: 'alice', status: 'AVAILABLE' };

  it('allows a hidden AVAILABLE card owned by the expected party', () => {
    expect(privateItemProblem(item, 'alice')).toBeNull();
  });

  it('refuses a catalog listing', () => {
    expect(privateItemProblem({ ...item, hidden: false }, 'alice')).toMatch(
      /unlisted/i,
    );
  });

  it('refuses another member’s card', () => {
    expect(privateItemProblem(item, 'bob')).toMatch(/own/i);
  });

  it('refuses a missing or reserved card', () => {
    expect(privateItemProblem(null, 'alice')).toBeTruthy();
    expect(privateItemProblem({ ...item, status: 'RESERVED' }, 'alice')).toBeTruthy();
  });
});

describe('claim routing', () => {
  it('has the joiner describe a card on trade and on cash-buyer-host', () => {
    expect(joinerPutsUpACard('TRADE', null)).toBe(true);
    expect(joinerPutsUpACard('CASH_SALE', 'BUYER')).toBe(true);
    expect(joinerPutsUpACard('CASH_SALE', 'SELLER')).toBe(false);
  });

  it('puts the cash seller on the host when the host is selling', () => {
    expect(cashDealParties('SELLER', 'host', 'joiner')).toEqual({
      sellerId: 'host',
      buyerId: 'joiner',
    });
    expect(cashDealParties('BUYER', 'host', 'joiner')).toEqual({
      sellerId: 'joiner',
      buyerId: 'host',
    });
  });
});
