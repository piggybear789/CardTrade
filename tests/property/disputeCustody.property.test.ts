// tests/property/disputeCustody.property.test.ts
//
// ESC-01 properties over random interleavings of raise / fraud claim (by either
// trader) / handover failed / custody backstop / staff resolution, run against the
// real coordinator and the bounded InMemoryService (design ESC-01 "Tests" (a)–(h)).
//
// The generators include trades whose INSPECTION audit row was dropped while
// `inspection_deadline_at` is set (R4-M1): such a trade DID reach inspection, and
// must be treated as inspected even with its history row missing.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  custodyCaptureHold,
  raiseConditionDispute,
  raiseFraudClaim,
  resolveTradeDispute,
  type TradeDisputeOutcome,
} from '@/domain/orchestrator/disputeResolution';
import { currentLiveHold } from '@/domain/bond/currentHolds';
import { TERMINAL_STATES } from '@/domain/state-machine/types';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { COUNTERPART, INITIATOR, createDisputeWorld } from '../unit/fakes/disputeWorld';

const STAFF = 'staff-1';
const TRADERS = [INITIATOR, COUNTERPART] as const;
/** INITIATOR pays the cash leg; COUNTERPART receives it. */
const RECEIVER = COUNTERPART;

type Step =
  | { kind: 'condition'; by: 0 | 1 }
  | { kind: 'fraudClaim'; by: 0 | 1 }
  | { kind: 'handoverFailed'; by: 0 | 1 }
  | { kind: 'backstop' }
  | { kind: 'resolve'; outcome: TradeDisputeOutcome };

const trader = fc.constantFrom<0 | 1>(0, 1);
const outcomeArb: fc.Arbitrary<TradeDisputeOutcome> = fc.oneof(
  fc.record({ kind: fc.constant('UNFOUNDED' as const), goodsChangedHands: fc.boolean() }),
  fc.record({
    kind: fc.constant('CONDITION' as const),
    wrongedTraderId: fc.constantFrom(INITIATOR, COUNTERPART),
    compensationMinor: fc.integer({ min: 0, max: 60_000 }),
    goodsChangedHands: fc.boolean(),
  }),
  fc.record({ kind: fc.constant('FRAUD' as const), victimId: fc.constantFrom(INITIATOR, COUNTERPART) }),
  fc.constant({ kind: 'NO_EXCHANGE' as const }),
);
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('condition' as const), by: trader }),
  fc.record({ kind: fc.constant('fraudClaim' as const), by: trader }),
  fc.record({ kind: fc.constant('handoverFailed' as const), by: trader }),
  fc.constant({ kind: 'backstop' as const }),
  fc.record({ kind: fc.constant('resolve' as const), outcome: outcomeArb }),
);

/** How the trade's history records INSPECTION. */
type InspectionHistory = 'NEVER' | 'ROW' | 'DEADLINE_ROW_DROPPED';
const startArb = fc.oneof(
  fc.constant({ state: 'COLLATERAL_LOCKED' as const, history: 'NEVER' as InspectionHistory }),
  fc.record({
    state: fc.constant('INSPECTION' as const),
    history: fc.constantFrom<InspectionHistory>('ROW', 'DEADLINE_ROW_DROPPED'),
  }),
);

async function run(start: { state: 'COLLATERAL_LOCKED' | 'INSPECTION'; history: InspectionHistory }, steps: Step[]) {
  const payments = new InMemoryService();
  const made = await createDisputeWorld({
    payments,
    state: start.state,
    cashAmountCents: 10_000,
    disputeRaisedBy: null,
    inspected: start.history === 'ROW',
    extraTrade: start.history === 'DEADLINE_ROW_DROPPED' ? { inspection_deadline_at: '2026-06-29T00:00:00.000Z' } : {},
  });
  const { world, deps } = made;
  const inspected = start.history !== 'NEVER';
  const fullHold = new Map(world.holds.map((h) => [h.holdRef, h.amountCents]));

  let movedMoney = false; // a resolution or the backstop ran
  let firstClaimByReceiverFromLocked = false;
  let anyClaimBeforeReceiver = false;
  const resolutions: Array<{ outcome: TradeDisputeOutcome; ok: boolean; error?: string }> = [];

  for (const step of steps) {
    const by = step.kind === 'backstop' || step.kind === 'resolve' ? null : TRADERS[step.by];
    if (step.kind === 'condition') {
      if (by !== RECEIVER) anyClaimBeforeReceiver = true;
      await raiseConditionDispute(deps, { tradeId: world.trade.id, actorId: by!, reason: 'condition' });
    } else if (step.kind === 'fraudClaim') {
      if (world.trade.state === 'COLLATERAL_LOCKED' && by === RECEIVER && !anyClaimBeforeReceiver) {
        firstClaimByReceiverFromLocked = true;
      }
      if (by !== RECEIVER) anyClaimBeforeReceiver = true;
      await raiseFraudClaim(deps, { tradeId: world.trade.id, actorId: by!, reason: 'fraud' });
    } else if (step.kind === 'handoverFailed') {
      if (by !== RECEIVER) anyClaimBeforeReceiver = true;
      await deps.orchestrator.applyEvent({ tradeId: world.trade.id, event: 'HANDOVER_FAILED', actorId: by! });
    } else if (step.kind === 'backstop') {
      if (world.trade.state === 'DISPUTED') {
        movedMoney = true;
        // custody_scope = 'ALL': every participant's live ACTIVE hold, whoever filed.
        for (const id of TRADERS) {
          const live = currentLiveHold(world.holds, id);
          if (live?.status === 'ACTIVE') {
            await custodyCaptureHold(deps, { tradeId: world.trade.id, holdRef: live.holdRef, reason: 'EXPIRY_BACKSTOP' });
          }
        }
        // (e) no participant's live hold is left uncaptured at the margin.
        for (const id of TRADERS) {
          expect(currentLiveHold(world.holds, id)?.status ?? 'NONE').not.toBe('ACTIVE');
        }
      }
    } else {
      const wasDisputed = world.trade.state === 'DISPUTED';
      const capturesBefore = payments.captures.length;
      const cashLegBefore = world.calls.cashLeg.length;
      const result = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: step.outcome });
      if (wasDisputed) movedMoney = true;
      resolutions.push({ outcome: step.outcome, ok: result.ok, error: result.ok ? undefined : result.error });

      if (result.ok) {
        // (b) a FRAUD finding over an open hold captures the offender's whole hold.
        if (step.outcome.kind === 'FRAUD') {
          const offender = step.outcome.victimId === INITIATOR ? COUNTERPART : INITIATOR;
          const offenderHold = world.holds.find((h) => h.traderId === offender)!;
          if (payments.captures.length > capturesBefore) {
            expect(offenderHold.capturedCents).toBe(fullHold.get(offenderHold.holdRef));
          }
        }
        // (f) NO_EXCHANGE only ever refunds a trader their own hold.
        if (step.outcome.kind === 'NO_EXCHANGE') {
          for (const d of world.disbursements) {
            expect(d.kind).toBe('REFUND');
            expect(world.holds.find((h) => h.holdRef === d.holdRef)?.traderId).toBe(d.payeeId);
          }
        }
        // (h) never-inspected: the cash leg is released to the receiver only with the
        // attestation (the legacy port's UNFOUNDED/CONDITION call is that release).
        const released = world.calls.cashLeg.slice(cashLegBefore).some((o) => o === 'UNFOUNDED' || o === 'CONDITION');
        if (!inspected && released) {
          expect(
            (step.outcome.kind === 'UNFOUNDED' || step.outcome.kind === 'CONDITION') && step.outcome.goodsChangedHands,
          ).toBe(true);
        }
      }
    }

    // (a) nothing is captured before a resolution or the backstop.
    if (!movedMoney) expect(payments.captures).toHaveLength(0);
    // (d) a trade is never terminal while any hold is ACTIVE.
    if (TERMINAL_STATES.has(world.trade.state)) {
      expect(world.holds.filter((h) => h.status === 'ACTIVE')).toEqual([]);
      for (const h of world.holds) expect(payments.holds.get(h.holdRef)?.status).not.toBe('ACTIVE');
    }
  }

  // (c) total disbursed never exceeds what was captured: every queued row drains.
  await made.drain();
  const captured = payments.captures.filter((c) => c.status === 'SETTLED').reduce((s, c) => s + c.amount, 0);
  const out =
    payments.refunds.filter((r) => r.status === 'SETTLED').reduce((s, r) => s + r.amount, 0) +
    payments.payouts.filter((p) => p.status === 'SETTLED').reduce((s, p) => s + p.amount, 0);
  expect(out).toBeLessThanOrEqual(captured);
  expect(world.disbursements.filter((d) => d.status === 'FAILED')).toEqual([]);

  return { world, inspected, firstClaimByReceiverFromLocked, resolutions, deps };
}

describe('dispute custody properties', () => {
  it('(a)–(f), (h) hold for any interleaving', async () => {
    await fc.assert(
      fc.asyncProperty(startArb, fc.array(stepArb, { minLength: 1, maxLength: 6 }), async (start, steps) => {
        await run(start, steps);
      }),
      { numRuns: 200 },
    );
  });

  it('(g) the receiver filing FRAUD_CLAIMED from LOCKED first never pre-empts NO_EXCHANGE', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof(
          fc.record({ kind: fc.constant('condition' as const), by: trader }),
          fc.record({ kind: fc.constant('fraudClaim' as const), by: trader }),
          fc.constant({ kind: 'backstop' as const }),
        ), { maxLength: 4 }),
        fc.constantFrom<InspectionHistory>('NEVER', 'DEADLINE_ROW_DROPPED'),
        async (later, history) => {
          // Receiver files first, from COLLATERAL_LOCKED.
          const steps: Step[] = [{ kind: 'fraudClaim', by: 1 }, ...later, { kind: 'resolve', outcome: { kind: 'NO_EXCHANGE' } }];
          const outcome = await run(
            { state: 'COLLATERAL_LOCKED', history: history === 'NEVER' ? 'NEVER' : 'DEADLINE_ROW_DROPPED' } as never,
            steps,
          );
          const last = outcome.resolutions[outcome.resolutions.length - 1];
          if (history === 'NEVER') {
            expect(outcome.firstClaimByReceiverFromLocked).toBe(true);
            expect(last).toMatchObject({ ok: true });
            expect(outcome.world.trade.state).toBe('CANCELLED');
          } else {
            // The deadline proves the trade reached INSPECTION; its lost audit row
            // must not reopen NO_EXCHANGE (R4-M1).
            expect(last).toMatchObject({ ok: false, error: 'INVALID_OUTCOME' });
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
