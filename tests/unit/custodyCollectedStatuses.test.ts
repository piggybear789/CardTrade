// tests/unit/custodyCollectedStatuses.test.ts
//
// Which Cash_Sale statuses mean the Buyer's money is sitting in the platform balance.
//
// WHY THIS HAS ITS OWN FILE. Custody reconciliation is the only figure on the admin
// console that is not circular: every other number is derived from `cash_sales`, which is
// a statement about our own belief, while this one compares that belief against the
// PROVIDER's balance. Its value depends entirely on the input list being complete.
//
// THE BUG THIS PINS. The list was `[...] as const satisfies readonly Enums<...>[]`, which
// checks every member is a real status and never that every status is a member. When 0088
// added RETURN_PENDING and RETURN_IN_TRANSIT — two states whose defining property is that
// the Buyer's full payment is STILL HELD while the goods travel back — they were simply
// absent. Nothing failed. The reconciliation would have understated what the platform
// owes, which is the one direction that hides an insolvency: it would agree with itself
// and report SOLVENT while short.
//
// The fix is a `Record` keyed on the enum, so a new status is a compile error until
// classified. This test guards the CLASSIFICATION, which a Record cannot: it stops
// someone satisfying the compiler by marking a money-holding state `false`.

import { describe, expect, it } from 'vitest';

import { CASH_SALE_STATUS_MAP } from '@/components/sales/CashSaleStatusBadge';
import {
  COLLECTED_SALE_STATUSES,
  MONEY_COLLECTED,
} from '@/domain/payouts/custodyReconciliation';

/** Every status the database can hold, from the one exhaustive map that already exists. */
const ALL_STATUSES = Object.keys(CASH_SALE_STATUS_MAP).sort();

describe('custody reconciliation inputs', () => {
  it('classifies every status the enum can hold', () => {
    // Not a restatement of the Record — a cross-check against a DIFFERENT exhaustive
    // structure. If someone adds a status and updates only one of them, this fails.
    expect(Object.keys(MONEY_COLLECTED).sort()).toEqual(ALL_STATUSES);
  });

  // THE ASSERTION THE ORIGINAL BUG WOULD HAVE FAILED.
  it('counts a full refund that is waiting on the goods', () => {
    // In both return states the decision is recorded and NO money has moved, so the
    // buyer's entire payment is still held and owed to them.
    expect(COLLECTED_SALE_STATUSES).toContain('RETURN_PENDING');
    expect(COLLECTED_SALE_STATUSES).toContain('RETURN_IN_TRANSIT');
  });

  it('counts every state where a payment has been collected and not yet released', () => {
    for (const status of [
      'ESCROW_HELD',
      'HANDOVER',
      'IN_TRANSIT',
      'INSPECTION',
      'COMPLETED',
      'DISPUTED',
      'REFUNDED',
    ] as const) {
      expect(COLLECTED_SALE_STATUSES).toContain(status);
    }
  });

  it('excludes states where nothing was ever collected', () => {
    // Counting these would invent an obligation the platform does not have, which makes
    // the check cry wolf — and a control that raises false alarms stops being read.
    for (const status of ['AGREEMENT', 'PAYMENT_PENDING', 'CANCELLED', 'FAILED'] as const) {
      expect(COLLECTED_SALE_STATUSES).not.toContain(status);
    }
  });
});
