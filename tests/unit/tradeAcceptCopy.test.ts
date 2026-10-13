// tests/unit/tradeAcceptCopy.test.ts
//
// The trade accept dialog's sentences (design §1.12, ESC-01). Built from the constants
// so they cannot drift: since disputes stopped capturing at raise, a hold about to
// expire on an open problem IS charged, so "not charged" became false; and collateral
// is never "escrow".

import { describe, expect, it } from 'vitest';

import { HOLD_DECLINED_MESSAGE, tradeAcceptCopy } from '@/lib/handover/terms';
import { BOND_PLACEMENT_LEAD_HOURS } from '@/domain/fulfilment';
import { tradeFeeRateLabel } from '@/lib/fees/feeLabels';

const copy = tradeAcceptCopy({ cashMinor: 0, payerIsViewer: false, bondMinor: 50_000, currency: 'aud' });
const all = [copy.description, copy.collateralHint, copy.feeHint].join(' ');

describe('tradeAcceptCopy', () => {
  it('never says escrow or "not charged"', () => {
    expect(all.toLowerCase()).not.toContain('escrow');
    expect(all.toLowerCase()).not.toContain('not charged');
  });

  it('reads the placement lead from the constant', () => {
    expect(copy.description).toContain(`${BOND_PLACEMENT_LEAD_HOURS} hours`);
  });

  it('names the fee rate from feeLabels and the hold amount', () => {
    expect(copy.description).toContain(tradeFeeRateLabel('aud'));
    expect(copy.description).toContain('$500.00');
  });

  it('says when the fee is charged and that an expiring hold on an open problem is charged', () => {
    expect(copy.feeHint).toBe('Charged when the card hold is placed.');
    expect(copy.collateralHint).toMatch(/charged and then refunded or paid out/);
  });

  it('emits no cash sentence before WP2', () => {
    const payer = tradeAcceptCopy({ cashMinor: 2_000, payerIsViewer: true, bondMinor: 50_000, currency: 'aud' });
    expect(payer.description).not.toMatch(/pay \$20/i);
  });

  it('names the card limit in the decline message', () => {
    expect(HOLD_DECLINED_MESSAGE).toMatch(/available limit/);
  });
});
