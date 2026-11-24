// tests/unit/e2eAudit/stripeFixtures.test.ts
//
// Guards over the audit's Stripe fixture data (`tests/e2e/audit/stripeFixtures.ts`).
// Requirements 13.19 and 24.2: every seed member is bound to its OWN card number and
// its OWN connected account, so no two seed members ever look related, and the saved
// label matches what the app writes.

import { describe, expect, it } from 'vitest';

import {
  BINDING_CARDS,
  DE_FIXTURE_ACCOUNT,
  ENTRY_CARDS,
  MEMBER_FIXTURES,
  paymentMethodLabel,
} from '../../e2e/audit/stripeFixtures';
import { SEED_USERS } from '../../e2e/support/users';

/** The Luhn check every real (and every published test) card number passes. */
function luhnValid(number: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = number.length - 1; i >= 0; i -= 1) {
    let digit = Number(number[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

describe('MEMBER_FIXTURES', () => {
  it('has an entry for every seed member, keyed by its profile id', () => {
    for (const user of SEED_USERS) {
      expect(MEMBER_FIXTURES[user.id]?.memberId, user.email).toBe(user.id);
      expect(MEMBER_FIXTURES[user.id]?.label, user.email).toBe(user.email.split('@')[0]);
    }
    expect(Object.keys(MEMBER_FIXTURES).sort()).toEqual(SEED_USERS.map((u) => u.id).sort());
  });

  it('never gives two members the same card number', () => {
    const numbers = Object.values(BINDING_CARDS).map((card) => card.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('never gives two members the same connected account, nor the DE one', () => {
    const ids = Object.values(MEMBER_FIXTURES)
      .map((f) => f.connectedAccount)
      .filter((id): id is string => id !== null);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(DE_FIXTURE_ACCOUNT);
    for (const id of ids) expect(id).toMatch(/^acct_[A-Za-z0-9]+$/);
  });

  it('describes each binding card consistently', () => {
    for (const card of Object.values(BINDING_CARDS)) {
      expect(luhnValid(card.number), card.token).toBe(true);
      expect(card.number.endsWith(card.last4), card.token).toBe(true);
      expect(card.token, card.number).toMatch(/^pm_card_[a-z_]+$/);
      expect(card.country, card.token).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('gives BOB the only Australian-issued test card, so he buys at the domestic rate', () => {
    const au = Object.values(MEMBER_FIXTURES).filter((f) => f.card.country === 'AU');
    expect(au.map((f) => f.label)).toEqual(['bob']);
  });

  it('puts each member on the platform its account country belongs to', () => {
    for (const fixture of Object.values(MEMBER_FIXTURES)) {
      expect(fixture.accountCountry.toUpperCase(), fixture.label).toBe(fixture.platform);
    }
  });
});

describe('ENTRY_CARDS', () => {
  it('are Luhn-valid and repeat no binding number except the documented AU card', () => {
    const bound = new Set(Object.values(BINDING_CARDS).map((card) => card.number));
    for (const [name, card] of Object.entries(ENTRY_CARDS)) {
      expect(luhnValid(card.number), name).toBe(true);
      expect(bound.has(card.number), name).toBe(name === 'auDomestic');
    }
  });
});

describe('paymentMethodLabel', () => {
  it('matches the label completeCardSetup writes', () => {
    expect(paymentMethodLabel('visa', '4242')).toBe('Visa •••• 4242');
    expect(paymentMethodLabel('mastercard', '4444')).toBe('Mastercard •••• 4444');
    expect(paymentMethodLabel('', '')).toBe('Card');
  });
});
