// tests/unit/custodyReconciliation.test.ts
//
// Custody reconciliation: does the platform hold the money it owes?
//
// THE PROPERTY THAT MATTERS MOST is that this never reports SOLVENT when it does not
// know. A monitoring panel that shows all-clear while its instrument is broken is worse
// than no panel — it turns an unknown into a false negative, and the whole point of this
// module is detecting a condition nothing else in the system can see.
//
// The second is directional: when the arithmetic is uncertain it must OVERSTATE what is
// owed, never understate it. Understating is the direction that hides an insolvency.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  heldForSale,
  reconcileCustody,
  type HeldSaleInput,
} from '@/domain/payouts/custodyReconciliation';

function sale(overrides: Partial<HeldSaleInput> = {}): HeldSaleInput {
  return {
    id: 'sale-1',
    collectedCents: 10_000,
    settledRefundCents: 0,
    fullyDisbursed: false,
    ...overrides,
  };
}

const readable = (availableCents: number, pendingCents = 0) => ({
  availableCents,
  pendingCents,
  readable: true,
});

describe('heldForSale', () => {
  it('counts the whole collected amount while a sale is live', () => {
    // The platform fee is NOT deducted. While a full refund is still possible that fee
    // may have to go back to the buyer, so counting only the seller's net would
    // understate the obligation.
    expect(heldForSale(sale({ collectedCents: 10_000 }))).toBe(10_000);
  });

  it('counts nothing once the sale is fully disbursed', () => {
    expect(heldForSale(sale({ fullyDisbursed: true }))).toBe(0);
  });

  it('subtracts refunds that have actually settled', () => {
    expect(heldForSale(sale({ collectedCents: 10_000, settledRefundCents: 4_000 }))).toBe(
      6_000,
    );
  });

  it('counts nothing when nothing was ever collected', () => {
    expect(heldForSale(sale({ collectedCents: 0 }))).toBe(0);
  });

  it('never returns a negative contribution', () => {
    // A refund larger than the collection would otherwise subtract from what other
    // members are owed, masking a real shortfall behind one bad row.
    expect(heldForSale(sale({ collectedCents: 5_000, settledRefundCents: 9_000 }))).toBe(0);
    expect(heldForSale(sale({ collectedCents: -100, settledRefundCents: 0 }))).toBe(0);
  });
});

describe('reconcileCustody', () => {
  it('reports SOLVENT with headroom when the balance covers what is owed', () => {
    const position = reconcileCustody({
      sales: [sale({ collectedCents: 10_000 })],
      balance: readable(15_000),
    });

    expect(position).toMatchObject({
      state: 'SOLVENT',
      heldForMembersCents: 10_000,
      providerBalanceCents: 15_000,
      shortfallCents: 0,
      surplusCents: 5_000,
      saleCount: 1,
    });
  });

  it('reports SHORTFALL with the exact gap when it does not', () => {
    // The case a real provider will not produce on demand, and the only one an operator
    // has to act on immediately.
    const position = reconcileCustody({
      sales: [sale({ id: 'a', collectedCents: 10_000 }), sale({ id: 'b', collectedCents: 5_000 })],
      balance: readable(9_000),
    });

    expect(position).toMatchObject({
      state: 'SHORTFALL',
      heldForMembersCents: 15_000,
      providerBalanceCents: 9_000,
      shortfallCents: 6_000,
      surplusCents: 0,
      saleCount: 2,
    });
  });

  it('counts pending alongside available', () => {
    // Card funds clear over days. Excluding pending would report a shortfall on every
    // healthy platform that took a payment this morning.
    const position = reconcileCustody({
      sales: [sale({ collectedCents: 10_000 })],
      balance: readable(2_000, 9_000),
    });

    expect(position.providerBalanceCents).toBe(11_000);
    expect(position.state).toBe('SOLVENT');
  });

  it('treats exactly covered as solvent, not short', () => {
    const position = reconcileCustody({
      sales: [sale({ collectedCents: 10_000 })],
      balance: readable(10_000),
    });
    expect(position.state).toBe('SOLVENT');
    expect(position.shortfallCents).toBe(0);
    expect(position.surplusCents).toBe(0);
  });

  it('reports UNKNOWN — never SOLVENT — when the balance cannot be read', () => {
    const position = reconcileCustody({
      sales: [sale({ collectedCents: 10_000 })],
      balance: { availableCents: 0, pendingCents: 0, readable: false },
    });

    expect(position.state).toBe('UNKNOWN');
    // Still reports what is owed: that half is knowable and useful on its own.
    expect(position.heldForMembersCents).toBe(10_000);
    // But claims nothing about coverage in either direction.
    expect(position.providerBalanceCents).toBe(0);
    expect(position.shortfallCents).toBe(0);
    expect(position.surplusCents).toBe(0);
  });

  it('reports UNKNOWN on an unreadable balance even with nothing owed', () => {
    // The tempting shortcut is "nothing owed, so we are fine". But an unreadable balance
    // means the instrument is broken, and a broken instrument must not read green.
    const position = reconcileCustody({
      sales: [],
      balance: { availableCents: 0, pendingCents: 0, readable: false },
    });
    expect(position.state).toBe('UNKNOWN');
  });

  it('is solvent with nothing owed and nothing held', () => {
    const position = reconcileCustody({ sales: [], balance: readable(0) });
    expect(position).toMatchObject({
      state: 'SOLVENT',
      heldForMembersCents: 0,
      saleCount: 0,
    });
  });

  it('excludes fully disbursed sales from the count as well as the total', () => {
    const position = reconcileCustody({
      sales: [
        sale({ id: 'live', collectedCents: 4_000 }),
        sale({ id: 'done', collectedCents: 90_000, fullyDisbursed: true }),
      ],
      balance: readable(4_000),
    });

    expect(position.heldForMembersCents).toBe(4_000);
    expect(position.saleCount).toBe(1);
    expect(position.state).toBe('SOLVENT');
  });

  it('never reports both a shortfall and a surplus, and never reports either negative', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            collectedCents: fc.integer({ min: -1_000, max: 2_000_000 }),
            settledRefundCents: fc.integer({ min: 0, max: 2_000_000 }),
            fullyDisbursed: fc.boolean(),
          }),
          { maxLength: 20 },
        ),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.boolean(),
        (specs, availableCents, pendingCents, isReadable) => {
          const position = reconcileCustody({
            sales: specs.map((spec, index) => ({ id: `s${index}`, ...spec })),
            balance: { availableCents, pendingCents, readable: isReadable },
          });

          expect(position.shortfallCents).toBeGreaterThanOrEqual(0);
          expect(position.surplusCents).toBeGreaterThanOrEqual(0);
          // Exactly one direction can be non-zero: a position cannot be both short and
          // in surplus, and reporting both would make the panel meaningless.
          expect(position.shortfallCents > 0 && position.surplusCents > 0).toBe(false);
          expect(position.heldForMembersCents).toBeGreaterThanOrEqual(0);

          if (!isReadable) {
            // The invariant this whole module exists for.
            expect(position.state).toBe('UNKNOWN');
          } else {
            expect(position.state).not.toBe('UNKNOWN');
            // The delta always reconciles against the two figures presented.
            expect(
              position.providerBalanceCents - position.heldForMembersCents,
            ).toBe(position.surplusCents - position.shortfallCents);
          }
        },
      ),
    );
  });
});
