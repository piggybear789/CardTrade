// tests/unit/settlementNotifier.test.ts
//
// The settlement notifications (FEAT-002): the in-app notifications fired the
// moment a purchase's money is committed — the cash-sale payment clearing into
// escrow, and a trade's collateral locking.
//
// These assert the CONTRACT of the copy, not just that something was sent:
//   * both parties are notified, with the right recipient ids and the SALE/TRADE
//     type;
//   * no currency figure leaks into a body (CashSaleRecord has no currency field
//     and hardcoding AUD is forbidden);
//   * trade copy uses card-hold language and never the word "escrow" (product.md).
//
// `createNotification` is mocked, so this is a pure assertion on what the helper
// asks for — the best-effort insert itself is exercised elsewhere.

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Note {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link: string;
}

const createNotification = vi.fn(async (_input: Note) => true);

vi.mock('@/lib/notifications/createNotification', () => ({
  createNotification: (input: Note) => createNotification(input),
}));

const { notifyCashSaleSettled, notifyTradeCollateralLocked } = await import(
  '@/lib/notifications/settlementNotifier'
);

beforeEach(() => {
  createNotification.mockClear();
});

describe('notifyCashSaleSettled', () => {
  it('notifies BOTH the buyer and the seller with distinct SALE notifications', async () => {
    await notifyCashSaleSettled({
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      cashSaleId: 'sale-1',
    });

    expect(createNotification).toHaveBeenCalledTimes(2);

    const notes = createNotification.mock.calls.map(([input]) => input);
    const buyerCall = notes.find((n) => n.userId === 'buyer-1');
    const sellerCall = notes.find((n) => n.userId === 'seller-1');

    expect(buyerCall).toBeDefined();
    expect(sellerCall).toBeDefined();
    if (!buyerCall || !sellerCall) throw new Error('missing notification');

    // Both are SALE notifications pointing at the contract room.
    expect(buyerCall.type).toBe('SALE');
    expect(sellerCall.type).toBe('SALE');
    expect(buyerCall.link).toBe('/sales/sale-1');
    expect(sellerCall.link).toBe('/sales/sale-1');

    // Distinct headlines: the buyer hears "paid and held", the seller "funds secured".
    expect(buyerCall.title).not.toBe(sellerCall.title);
  });

  it('embeds no currency figure in either body', async () => {
    await notifyCashSaleSettled({
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      cashSaleId: 'sale-1',
    });

    for (const [input] of createNotification.mock.calls) {
      const body = input.body ?? '';
      // No AUD, no dollar figure - the room formats the amount correctly.
      expect(body).not.toMatch(/\$\s*\d/);
      expect(body).not.toMatch(/\bAUD\b/i);
    }
  });
});

describe('notifyTradeCollateralLocked', () => {
  it('notifies BOTH traders with a TRADE notification', async () => {
    await notifyTradeCollateralLocked({
      initiatorId: 'trader-a',
      counterpartId: 'trader-b',
      tradeId: 'trade-1',
    });

    expect(createNotification).toHaveBeenCalledTimes(2);
    const recipients = createNotification.mock.calls.map(([input]) => input.userId);
    expect(recipients).toContain('trader-a');
    expect(recipients).toContain('trader-b');

    for (const [note] of createNotification.mock.calls) {
      expect(note.type).toBe('TRADE');
      expect(note.link).toBe('/trades/trade-1');
    }
  });

  it('uses card-hold language and never says "escrow" (product.md)', async () => {
    await notifyTradeCollateralLocked({
      initiatorId: 'trader-a',
      counterpartId: 'trader-b',
      tradeId: 'trade-1',
    });

    for (const [note] of createNotification.mock.calls) {
      expect(`${note.title} ${note.body ?? ''}`.toLowerCase()).not.toContain('escrow');
    }
  });
});
