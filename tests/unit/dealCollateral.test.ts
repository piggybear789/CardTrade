// tests/unit/dealCollateral.test.ts
//
// The deal collateral policy: identity or money (or opt-in escrow).
// Verified-to-verified deals hold nothing by default; if either party is
// unverified — or the deal opts into DittoEscrow — BOTH post the stake.

import { describe, expect, it } from 'vitest';

import {
  dealStakeCents,
  resolveDealCollateral,
  DEFAULT_DEAL_COLLATERAL_POLICY,
} from '@/domain/deal/dealCollateral';

const POLICY = DEFAULT_DEAL_COLLATERAL_POLICY;

describe('dealStakeCents', () => {
  it('prefers an explicitly agreed collateral amount', () => {
    expect(dealStakeCents({ collateralCents: 25_000, cashAmountCents: 9_000 })).toBe(
      25_000,
    );
  });

  it('falls back to the cash component, then the flat default', () => {
    expect(dealStakeCents({ cashAmountCents: 9_000 })).toBe(9_000);
    expect(dealStakeCents({})).toBe(POLICY.defaultCents);
    expect(dealStakeCents({ collateralCents: null, cashAmountCents: null })).toBe(
      POLICY.defaultCents,
    );
  });

  it('never returns a stake below the minimum or above the maximum', () => {
    expect(dealStakeCents({ cashAmountCents: 1 })).toBe(POLICY.defaultCents);
    expect(dealStakeCents({ collateralCents: POLICY.maxCents + 10_000 })).toBe(
      POLICY.maxCents,
    );
  });
});

describe('resolveDealCollateral', () => {
  const basis = { cashAmountCents: 50_000 };

  it('holds nothing when both parties are verified', () => {
    const outcome = resolveDealCollateral({
      creator: true,
      counterparty: true,
      basis,
    });
    expect(outcome).toMatchObject({
      perPartyCents: 0,
      required: false,
      reason: 'BOTH_VERIFIED',
      stakeCents: 50_000,
    });
  });

  it('holds the stake on BOTH parties when opt-in is on, even if both verified', () => {
    const outcome = resolveDealCollateral({
      creator: true,
      counterparty: true,
      optIn: true,
      basis,
    });
    expect(outcome).toMatchObject({
      required: true,
      perPartyCents: 50_000,
      reason: 'OPT_IN',
      stakeCents: 50_000,
    });
  });

  it('holds the stake on BOTH parties when the counterparty is unverified', () => {
    const outcome = resolveDealCollateral({
      creator: true,
      counterparty: false,
      basis,
    });
    expect(outcome.required).toBe(true);
    expect(outcome.perPartyCents).toBe(50_000);
    expect(outcome.reason).toBe('UNVERIFIED_PARTY');
  });

  it('holds the stake on both parties when the creator is unverified', () => {
    const outcome = resolveDealCollateral({
      creator: false,
      counterparty: true,
      basis,
    });
    expect(outcome.perPartyCents).toBe(50_000);
  });

  it('reports only the creator while the deal is unjoined', () => {
    expect(
      resolveDealCollateral({ creator: true, counterparty: null, basis }),
    ).toMatchObject({ perPartyCents: 0, required: false, reason: 'AWAITING_JOIN' });

    expect(
      resolveDealCollateral({ creator: false, counterparty: null, basis }),
    ).toMatchObject({
      perPartyCents: 50_000,
      required: true,
      reason: 'UNVERIFIED_PARTY',
    });

    expect(
      resolveDealCollateral({
        creator: true,
        counterparty: null,
        optIn: true,
        basis,
      }),
    ).toMatchObject({
      perPartyCents: 50_000,
      required: true,
      reason: 'OPT_IN',
    });
  });

  it('respects a tuned bond rate and ceiling', () => {
    const outcome = resolveDealCollateral({
      creator: false,
      counterparty: false,
      basis: { cashAmountCents: 100_000 },
      policy: { bond: { unverifiedRateBps: 5_000, ceilingCents: 30_000 } },
    });
    expect(outcome.perPartyCents).toBe(30_000);
    expect(outcome.stakeCents).toBe(100_000);
  });
});
