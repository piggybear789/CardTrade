// tests/unit/tradeHandoverEdits.test.ts
//
// ESC-04: who may move the meeting, when, and what an abandoned trade releases.
//
// The attack: after taking the other trader's card at the meeting, move the meeting a
// month out (or null it / switch to post) so the handover sweep never fires and the
// victim's remedy lapses with the collateral. Edits are now direct only while
// negotiating, a PROPOSAL the other trader must accept while collateral is pending and
// before the placement cutoff, and refused after that.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptanceToClear,
  handoverEditMode,
  placementCutoff,
  proposalMeetingIsPlaceable,
} from '@/domain/fulfilment/handoverEdits';
import { BOND_PLACEMENT_LEAD_HOURS, validateFulfilmentTerms, TRADE_HANDOVER_METHODS } from '@/domain/fulfilment';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-13T12:00:00.000Z');
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();

describe('handoverEditMode — the state matrix', () => {
  it('is DIRECT while negotiating', () => {
    expect(handoverEditMode({ state: 'NEGOTIATING', meetingAt: at(2), hasActiveHold: false, now: NOW })).toBe('DIRECT');
  });

  it('is a PROPOSAL in COLLATERAL_PENDING before the placement cutoff with no live hold', () => {
    const meetingAt = at(BOND_PLACEMENT_LEAD_HOURS + 5);
    expect(handoverEditMode({ state: 'COLLATERAL_PENDING', meetingAt, hasActiveHold: false, now: NOW })).toBe('PROPOSAL');
  });

  it('a FAILED/VOIDED-only history still allows a proposal (hasActiveHold is the only hold input)', () => {
    expect(
      handoverEditMode({ state: 'COLLATERAL_PENDING', meetingAt: at(48), hasActiveHold: false, now: NOW }),
    ).toBe('PROPOSAL');
  });

  it('is LOCKED once a hold is live, or once the cutoff has passed', () => {
    expect(handoverEditMode({ state: 'COLLATERAL_PENDING', meetingAt: at(48), hasActiveHold: true, now: NOW })).toBe('LOCKED');
    expect(
      handoverEditMode({ state: 'COLLATERAL_PENDING', meetingAt: at(BOND_PLACEMENT_LEAD_HOURS - 1), hasActiveHold: false, now: NOW }),
    ).toBe('LOCKED');
  });

  it.each(['COLLATERAL_LOCKED', 'IN_TRANSIT', 'INSPECTION', 'DISPUTED', 'COMPLETED', 'CANCELLED'] as const)(
    'is LOCKED in %s (the reported attack ran from COLLATERAL_LOCKED)',
    (state) => {
      expect(handoverEditMode({ state, meetingAt: at(48), hasActiveHold: false, now: NOW })).toBe('LOCKED');
    },
  );
});

describe('proposal validation', () => {
  it('refuses a proposed meeting inside the placement window, at proposal and at acceptance', () => {
    expect(proposalMeetingIsPlaceable(at(BOND_PLACEMENT_LEAD_HOURS), NOW)).toBe(false);
    expect(proposalMeetingIsPlaceable(at(BOND_PLACEMENT_LEAD_HOURS + 2), NOW)).toBe(true);
    // Accepted a day later: the same meeting is now too close.
    const later = new Date(NOW.getTime() + 24 * HOUR);
    expect(proposalMeetingIsPlaceable(at(BOND_PLACEMENT_LEAD_HOURS + 2), later)).toBe(false);
    expect(proposalMeetingIsPlaceable(null, NOW)).toBe(false);
  });

  it('computes the cutoff as meeting minus the placement lead', () => {
    expect(placementCutoff(at(30))).toBe(NOW.getTime() + (30 - BOND_PLACEMENT_LEAD_HOURS) * HOUR);
    expect(placementCutoff(null)).toBeNull();
  });
});

describe('method allowlist', () => {
  it('refuses DELIVERY on a trade (switching to post nulled meeting_at)', () => {
    const result = validateFulfilmentTerms(
      { method: 'DELIVERY', meeting: { place: null, at: null }, delivery: { costCents: 500, notes: null } },
      { allowedMethods: TRADE_HANDOVER_METHODS },
    );
    expect(result).toEqual({ ok: false, error: 'method-not-supported' });
  });
});

describe('acceptanceToClear — a negotiating edit clears only the OTHER party', () => {
  it('initiator edits → counterpart acceptance cleared', () => {
    expect(acceptanceToClear('initiator')).toEqual({
      acceptedAt: 'counterpart_terms_accepted_at',
      acceptedVersion: 'counterpart_terms_accepted_version',
    });
  });
  it('counterpart edits → initiator acceptance cleared', () => {
    expect(acceptanceToClear('counterpart').acceptedAt).toBe('initiator_terms_accepted_at');
  });
});

// ---------------------------------------------------------------------------
// The one abandon operation
// ---------------------------------------------------------------------------

const state = {
  trade: { id: 't1', state: 'COLLATERAL_PENDING', initiator_id: 'a', counterpart_id: 'b' } as Record<string, unknown>,
  holds: [] as Array<{ traderId: string; holdRef: string; status: string }>,
  voidResult: 'VOIDED',
  tradeUpdates: [] as unknown[],
  events: [] as string[],
};

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === 'trades' ? { ...state.trade } : null, error: null }),
        update: (payload: unknown) => {
          if (table === 'trades') state.tradeUpdates.push(payload);
          return chain;
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock('@/domain/orchestrator/supabaseTradeProposalRepository', () => ({
  createSupabaseTradeProposalRepository: () => ({
    getHolds: async () => state.holds,
    markHoldStatus: async (ref: string, status: string) => {
      const row = state.holds.find((h) => h.holdRef === ref);
      if (row) row.status = status;
    },
    restoreTradeItemsIfUnclaimed: async () => ['item-1'],
  }),
}));
const voidHold = vi.fn(async () => ({ status: state.voidResult }));
vi.mock('@/domain/services', () => ({
  getPaymentService: () => ({ voidHold }),
  isLivePaymentsProvider: () => false,
}));
vi.mock('@/lib/regionBinding', () => ({ regionForTrade: async () => 'AU' }));
vi.mock('@/lib/trades/tradeOrchestrator', () => ({
  createLoggedTradeOrchestrator: () => ({
    applyEvent: async ({ event }: { event: string }) => {
      state.events.push(event);
      state.trade.state = 'CANCELLED';
      return { ok: true, trade: { ...state.trade } };
    },
  }),
}));
const refundTradeFees = vi.fn(async () => 0);
vi.mock('@/lib/actions/tradeFees', () => ({ refundTradeFees: () => refundTradeFees(), chargeTradeFees: vi.fn() }));
vi.mock('@/lib/errors/errorLog', () => ({ logBackgroundFailure: vi.fn(async () => undefined) }));
vi.mock('@/lib/notifications/createNotification', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/identityGate', () => ({ readIdentityGate: vi.fn(), identityGateMessage: vi.fn() }));
vi.mock('@/lib/trades/collateralLock', () => ({ confirmTradeCollateral: vi.fn() }));

describe('abandonCollateralPendingTrade', () => {
  beforeEach(() => {
    state.trade = { id: 't1', state: 'COLLATERAL_PENDING', initiator_id: 'a', counterpart_id: 'b' };
    state.holds = [];
    state.voidResult = 'VOIDED';
    state.tradeUpdates = [];
    state.events = [];
    voidHold.mockClear();
    refundTradeFees.mockClear();
  });

  it('refunds charged fees exactly once and restores through the filtered restore', async () => {
    const { abandonCollateralPendingTrade } = await import('@/lib/trades/collateralPlacement');
    const result = await abandonCollateralPendingTrade('t1', 'MEETING_PASSED_UNLOCKED');
    expect(result).toEqual({ ok: true, abandoned: true, restoredItemIds: ['item-1'], feeRefundFailed: false });
    expect(refundTradeFees).toHaveBeenCalledTimes(1);
    expect(state.events).toEqual(['COLLATERAL_ABANDONED']);
  });

  it('voids one ACTIVE hold BEFORE the transition', async () => {
    state.holds = [
      { traderId: 'a', holdRef: 'pi_a', status: 'ACTIVE' },
      { traderId: 'b', holdRef: 'pi_b', status: 'FAILED' },
    ];
    const { abandonCollateralPendingTrade } = await import('@/lib/trades/collateralPlacement');
    await abandonCollateralPendingTrade('t1', 'MEETING_PASSED_UNLOCKED');
    expect(voidHold).toHaveBeenCalledTimes(1);
    expect(voidHold).toHaveBeenCalledWith('pi_a');
    expect(state.holds[0].status).toBe('VOIDED');
    expect(state.events).toEqual(['COLLATERAL_ABANDONED']);
  });

  it('a failed void leaves the trade COLLATERAL_PENDING with manual_reconciliation set', async () => {
    state.holds = [{ traderId: 'a', holdRef: 'pi_a', status: 'ACTIVE' }];
    state.voidResult = 'FAILED';
    const { abandonCollateralPendingTrade } = await import('@/lib/trades/collateralPlacement');
    const result = await abandonCollateralPendingTrade('t1', 'MEETING_PASSED_UNLOCKED');
    expect(result).toEqual({ ok: false, error: 'VOID_FAILED' });
    expect(state.events).toEqual([]);
    expect(state.trade.state).toBe('COLLATERAL_PENDING');
    expect(state.tradeUpdates).toContainEqual({ manual_reconciliation: true });
    expect(refundTradeFees).not.toHaveBeenCalled();
  });

  it('does nothing to a trade that already left COLLATERAL_PENDING', async () => {
    state.trade.state = 'COLLATERAL_LOCKED';
    const { abandonCollateralPendingTrade } = await import('@/lib/trades/collateralPlacement');
    expect(await abandonCollateralPendingTrade('t1', 'MEETING_PASSED_UNLOCKED')).toEqual({
      ok: true,
      abandoned: false,
      reason: 'NOT_PENDING',
    });
    expect(voidHold).not.toHaveBeenCalled();
  });
});
