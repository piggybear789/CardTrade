// tests/unit/cashSaleErrors.test.ts
//
// Pins the member-facing copy for a refused Cash_Sale against the codes the
// orchestrator actually emits.
//
// WHY THIS EXISTS. Two surfaces open a Cash_Sale — the Buy button and accepting an
// Offer — and both had their own refusal map. Both were wrong, in opposite ways
// that a passing app hid:
//
//   * `BuyButton` keyed its map in kebab-case (`'no-payment-method'`) while
//     `CashSaleError` is SCREAMING_SNAKE. Not one key ever matched. It looked fine
//     because the action also returns a `message` which was read first, so the map
//     was dead code that appeared to work.
//   * `OffersSection` ignored the code entirely and printed "the item may no longer
//     be available" for every failure — which for the commonest refusal (no saved
//     card) is both unactionable and false.
//
// The e2e suite caught the second one and cannot re-catch either: a saved card
// persists and teardown does not remove payment methods, so "this member has no
// card" is a state that exists exactly once per environment. The mapping is pure,
// so it is pinned here instead, where it runs on every commit.

import { describe, expect, it } from 'vitest';

import {
  CASH_SALE_REFUSAL_COPY,
  cashSaleRefusalMessage,
} from '@/lib/cashSaleErrors';
import type { CashSaleError } from '@/domain/orchestrator/cashSaleOrchestrator';

/**
 * Codes a MEMBER can cause and must be told how to resolve.
 *
 * Typed as `CashSaleError[]`, which is the actual guard: a rename in the
 * orchestrator's union fails compilation here rather than silently unmapping a
 * refusal at runtime. That is the exact failure mode the kebab-case map had, and a
 * plain `string[]` would reproduce it.
 */
const MEMBER_FACING: CashSaleError[] = [
  'BUYER_NO_PAYMENT_METHOD',
  'BUYER_CONFIRMATION_REQUIRED',
  'SELLER_IDENTITY_UNVERIFIED',
  'SELLER_IDENTITY_CHANGED',
  'SELLER_NOT_PAYABLE',
  'REGION_MISMATCH',
  'ITEM_NOT_FOUND',
  'ITEM_UNAVAILABLE',
  'SELF_PURCHASE',
  'INVALID_TERMS',
  'STALE_TERMS',
  'TRANSFER_FAILED',
];

describe('cash sale refusal copy', () => {
  it('covers every member-facing refusal', () => {
    for (const code of MEMBER_FACING) {
      expect(CASH_SALE_REFUSAL_COPY[code], `no copy for ${code}`).toBeTruthy();
    }
  });

  it('uses only SCREAMING_SNAKE keys', () => {
    // The original bug in one assertion: a kebab-case key can never match a
    // `CashSaleError`, so a map full of them is inert while looking complete.
    for (const key of Object.keys(CASH_SALE_REFUSAL_COPY)) {
      expect(key, `${key} is not a CashSaleError shape`).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('tells a buyer with no card what to do, and does not blame the listing', () => {
    const message = CASH_SALE_REFUSAL_COPY.BUYER_NO_PAYMENT_METHOD;
    // Actionable: it names the thing the member has to add.
    expect(message).toMatch(/card/i);
    // And it must NOT resurrect the copy that sent buyers away from a live listing.
    expect(message).not.toMatch(/no longer/i);
  });

  it('keeps identity and payability distinct', () => {
    // 0069: the Identity_Gate and payout readiness are independent, so their
    // refusals must not read the same — conflating them is what the two-step
    // verification model exists to avoid.
    expect(CASH_SALE_REFUSAL_COPY.SELLER_IDENTITY_UNVERIFIED).not.toBe(
      CASH_SALE_REFUSAL_COPY.SELLER_NOT_PAYABLE,
    );
    expect(CASH_SALE_REFUSAL_COPY.SELLER_IDENTITY_UNVERIFIED).toMatch(/identit/i);
    expect(CASH_SALE_REFUSAL_COPY.SELLER_NOT_PAYABLE).toMatch(/payment|paid|payout/i);
  });

  it('blames neither party for a region mismatch', () => {
    // 0065 treats it as a precondition, not a rejection: both members may be
    // perfectly able to transact, just not with each other.
    const message = CASH_SALE_REFUSAL_COPY.REGION_MISMATCH;
    expect(message).toMatch(/region/i);
    expect(message).not.toMatch(/not verified|unverified|cannot/i);
  });

  describe('cashSaleRefusalMessage', () => {
    it('prefers mapped copy over the raw detail', () => {
      expect(
        cashSaleRefusalMessage('BUYER_NO_PAYMENT_METHOD', 'BUYER_NO_PAYMENT_METHOD'),
      ).toBe(CASH_SALE_REFUSAL_COPY.BUYER_NO_PAYMENT_METHOD);
    });

    it('falls back to the server detail for an unmapped code', () => {
      // Operator-side failures are deliberately unmapped: no member action resolves
      // them, so inventing reassuring copy would bury a problem that needs the
      // server's own message.
      expect(cashSaleRefusalMessage('PAYOUT_FAILED', 'Transfer rejected by Stripe')).toBe(
        'Transfer rejected by Stripe',
      );
    });

    it('never returns an empty string', () => {
      for (const input of [null, undefined, '', 'TOTALLY_UNKNOWN']) {
        expect(cashSaleRefusalMessage(input)).toBeTruthy();
      }
    });

    it('does not leak a bare error code as user-facing copy', () => {
      // What the member saw before the map was fixed: "BUYER_NO_PAYMENT_METHOD" in a
      // toast. A code is not a sentence.
      expect(cashSaleRefusalMessage('BUYER_NO_PAYMENT_METHOD')).not.toMatch(/^[A-Z_]+$/);
    });
  });
});
