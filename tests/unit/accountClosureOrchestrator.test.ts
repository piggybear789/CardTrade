// tests/unit/accountClosureOrchestrator.test.ts
//
// Example tests for the Account_Closure_Service use case (Req 7.1, 7.2, 7.3, 7.7).
// The money rule itself is covered by the properties in
// `tests/property/accountClosure.test.ts`; these cover the orchestrator's own
// behaviour: the own-account guard, the refusal carrying its categories, the order
// of operations, and what is true when a late step fails.

import { describe, expect, it } from 'vitest';
import {
  closeAccount,
  type AccountClosureRepository,
} from '@/domain/orchestrator/accountClosureOrchestrator';
import type { MoneyInFlightSnapshot } from '@/domain/account/accountClosure';

const CLEAR: MoneyInFlightSnapshot = {
  activeCashSaleCount: 0,
  activeTradeCollateralCount: 0,
  pendingPayoutCount: 0,
  openDisputeCount: 0,
};

const AT = new Date('2026-03-04T05:06:07.000Z');

/** A recording fake. `failOn` makes exactly one step reject. */
function fakeRepo(options: {
  snapshot?: MoneyInFlightSnapshot;
  loadThrows?: boolean;
  failOn?: 'anonymiseProfile' | 'markClosed' | 'revokeSessions' | 'detachAuthIdentity';
}) {
  const calls: string[] = [];
  let closedAt: Date | null = null;

  const step = (name: NonNullable<typeof options.failOn>) => async () => {
    calls.push(name);
    if (options.failOn === name) throw new Error(`${name} failed`);
  };

  const repo: AccountClosureRepository = {
    async loadMoneyInFlight() {
      calls.push('loadMoneyInFlight');
      if (options.loadThrows) throw new Error('unreadable');
      return options.snapshot ?? CLEAR;
    },
    anonymiseProfile: step('anonymiseProfile'),
    async markClosed(_profileId, at) {
      calls.push('markClosed');
      if (options.failOn === 'markClosed') throw new Error('markClosed failed');
      closedAt = at;
    },
    revokeSessions: step('revokeSessions'),
    detachAuthIdentity: step('detachAuthIdentity'),
  };

  return { repo, calls, closedAtWritten: () => closedAt };
}

describe('closeAccount', () => {
  it('closes an eligible own account and reports the injected instant (Req 7.2)', async () => {
    const { repo, calls, closedAtWritten } = fakeRepo({});

    const result = await closeAccount(repo, {
      callerProfileId: 'p1',
      targetProfileId: 'p1',
      at: AT,
    });

    expect(result).toEqual({ ok: true, data: { closedAt: '2026-03-04T05:06:07.000Z' } });
    expect(closedAtWritten()).toBe(AT);
    expect(calls).toEqual([
      'loadMoneyInFlight',
      'anonymiseProfile',
      'markClosed',
      'revokeSessions',
      'detachAuthIdentity',
    ]);
  });

  it('refuses another member’s account with a distinct code and writes nothing (Req 7.7)', async () => {
    const { repo, calls } = fakeRepo({});

    const result = await closeAccount(repo, {
      callerProfileId: 'p1',
      targetProfileId: 'p2',
      at: AT,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('NOT_ACCOUNT_OWNER');
    expect(calls).toEqual([]);
  });

  it('refuses an empty caller rather than matching an empty target (Req 7.7)', async () => {
    const { repo, calls } = fakeRepo({});

    const result = await closeAccount(repo, {
      callerProfileId: '',
      targetProfileId: '',
      at: AT,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('NOT_ACCOUNT_OWNER');
    expect(calls).toEqual([]);
  });

  it('refuses while money is in flight and returns the categories (Req 7.3)', async () => {
    const { repo, calls } = fakeRepo({
      snapshot: { ...CLEAR, openDisputeCount: 1, activeCashSaleCount: 2 },
    });

    const result = await closeAccount(repo, {
      callerProfileId: 'p1',
      targetProfileId: 'p1',
      at: AT,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('MONEY_IN_FLIGHT');
      expect(result.blockers).toEqual(['ACTIVE_CASH_SALE', 'OPEN_DISPUTE']);
    }
    // A refusal is a refusal, not a queue: nothing was written.
    expect(calls).toEqual(['loadMoneyInFlight']);
  });

  it('refuses fail-closed when the snapshot cannot be read', async () => {
    const { repo, calls } = fakeRepo({ loadThrows: true });

    const result = await closeAccount(repo, {
      callerProfileId: 'p1',
      targetProfileId: 'p1',
      at: AT,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('ELIGIBILITY_UNREADABLE');
    expect(calls).toEqual(['loadMoneyInFlight']);
  });

  it('anonymises before marking closed, and stops if anonymising fails', async () => {
    const { repo, calls } = fakeRepo({ failOn: 'anonymiseProfile' });

    const result = await closeAccount(repo, {
      callerProfileId: 'p1',
      targetProfileId: 'p1',
      at: AT,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('ANONYMISE_FAILED');
    expect(calls).toEqual(['loadMoneyInFlight', 'anonymiseProfile']);
  });

  it('does not report success when the auth identity could not be detached', async () => {
    const { repo, calls, closedAtWritten } = fakeRepo({ failOn: 'detachAuthIdentity' });

    const result = await closeAccount(repo, {
      callerProfileId: 'p1',
      targetProfileId: 'p1',
      at: AT,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('DETACH_INCOMPLETE');
    // The account IS closed; only the last step is outstanding.
    expect(closedAtWritten()).toBe(AT);
    expect(calls).toContain('detachAuthIdentity');
  });

  it('does not report success when sessions could not be revoked', async () => {
    const { repo, calls } = fakeRepo({ failOn: 'revokeSessions' });

    const result = await closeAccount(repo, {
      callerProfileId: 'p1',
      targetProfileId: 'p1',
      at: AT,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('SIGN_OUT_INCOMPLETE');
    expect(calls).not.toContain('detachAuthIdentity');
  });
});
