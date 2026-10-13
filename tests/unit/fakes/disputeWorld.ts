// tests/unit/fakes/disputeWorld.ts
//
// An in-memory trade dispute "world" for the dispute tests: one trade, its holds,
// its audit history, its queued collateral disbursements and its items, behind the
// real interfaces the coordinator depends on.
//
// - The trade orchestrator is the REAL guarded transition core
//   (`createTradeOrchestrator`) over a fake TradeRepository on the same world, so a
//   transition the state machine refuses is refused here too.
// - Holds are placed through the injected PaymentService (normally the bounded
//   InMemoryService), so a capture or refund the provider would refuse fails here.
// - The disbursement queue can be drained by the real
//   `processDueCollateralDisbursements` through `drain()`.

import {
  createDisputeResolutionOrchestrator,
  type DisputeHold,
  type DisputeNotifier,
  type DisputeResolutionDeps,
  type DisputeResolutionOrchestrator,
  type DisputeResolutionRepository,
  type NewCollateralDisbursement,
} from '@/domain/orchestrator/disputeResolution';
import {
  createTradeOrchestrator,
  type TradeRecord,
  type TradeRepository,
  type TransitionAudit,
} from '@/domain/orchestrator/tradeOrchestrator';
import {
  processDueCollateralDisbursements,
  type CollateralDisbursementRepository,
  type CollateralDisbursementRow,
} from '@/domain/orchestrator/collateralDisbursement';
import type { MerchantRecord } from '@/domain/orchestrator/merchantOnboarding';
import type { TradeState } from '@/domain/state-machine/types';
import type { PaymentService } from '@/domain/services/types';
import type { TradeCashLegPort, TradeDisputeOutcomeKind } from '@/domain/orchestrator/tradeCashLeg';

export const INITIATOR = 'trader-a';
export const COUNTERPART = 'trader-b';

export interface WorldItem {
  id: string;
  ownerId: string;
  status: 'AVAILABLE' | 'RESERVED' | 'SOLD';
  listingKind: 'SINGLE' | 'SHOPFRONT';
  /** Another live cash sale or trade holds it, so the filtered restore must skip it. */
  claimedElsewhere?: boolean;
}

export interface WorldDisbursement extends NewCollateralDisbursement {
  id: string;
  status: 'PENDING' | 'SETTLED' | 'FAILED' | 'NOT_DUE';
  releaseAt: string | null;
  attempts: number;
  createdAt: string;
}

export interface DisputeWorld {
  trade: TradeRecord;
  holds: DisputeHold[];
  transitions: Array<{ from: TradeState; to: TradeState; event: string; by: string | null }>;
  disbursements: WorldDisbursement[];
  items: WorldItem[];
  unfounded: Record<string, number>;
  fraudClaims: Array<{ claimantId: string; reason: string }>;
  outcome: { outcome: string; attestedBy: string | null; cancelled: boolean } | null;
  manualReconciliation: boolean;
  fullCaptureFailed: boolean;
  /** Make `hasReachedInspection` throw. */
  historyFails: boolean;
  /** Make the next audit insert fail (the fake orchestrator still commits). */
  dropAuditRows: boolean;
  calls: {
    cashLeg: TradeDisputeOutcomeKind[];
    refundFees: string[];
    notifications: string[];
    restored: string[][];
  };
}

export interface WorldOptions {
  payments: PaymentService;
  state?: TradeState;
  cashAmountCents?: number;
  currency?: string;
  /** Holds to place through `payments`, per trader. */
  holdAmounts?: { initiator?: number | null; counterpart?: number | null };
  inspected?: boolean;
  disputeRaisedBy?: string | null;
  extraTrade?: Record<string, unknown>;
  items?: WorldItem[];
  now?: () => Date;
}

let seq = 0;

export async function createDisputeWorld(options: WorldOptions): Promise<{
  world: DisputeWorld;
  repository: DisputeResolutionRepository;
  coordinator: DisputeResolutionOrchestrator;
  deps: DisputeResolutionDeps;
  /** Drain every PENDING/FAILED disbursement now, ignoring the holdback. */
  drain: (payees?: Record<string, MerchantRecord>) => Promise<void>;
}> {
  const now = options.now ?? (() => new Date('2026-07-01T00:00:00.000Z'));
  const world: DisputeWorld = {
    trade: {
      id: `trade-${++seq}`,
      state: options.state ?? 'DISPUTED',
      version: 1,
      initiator_id: INITIATOR,
      counterpart_id: COUNTERPART,
      currency: options.currency ?? 'aud',
      cash_amount_cents: options.cashAmountCents ?? 0,
      dispute_raised_by: options.disputeRaisedBy === undefined ? INITIATOR : options.disputeRaisedBy,
      disputed_against: COUNTERPART,
      inspection_deadline_at: null,
      friction_tax_return_cents: null,
      friction_tax_return_paid_at: null,
      friction_tax_platform_cents: null,
      ...options.extraTrade,
    },
    holds: [],
    transitions: [],
    disbursements: [],
    items: options.items ?? [],
    unfounded: {},
    fraudClaims: [],
    outcome: null,
    manualReconciliation: false,
    fullCaptureFailed: false,
    historyFails: false,
    dropAuditRows: false,
    calls: { cashLeg: [], refundFees: [], notifications: [], restored: [] },
  };
  if (options.inspected) {
    world.transitions.push({ from: 'COLLATERAL_LOCKED', to: 'INSPECTION', event: 'BOTH_HANDOVER_CONFIRMED', by: INITIATOR });
  }

  const place = async (traderId: string, amount: number | null | undefined) => {
    if (!amount) return;
    const hold = await options.payments.placeHold({ payerId: `payer_${traderId}`, amount, ref: `hold:${world.trade.id}:${traderId}` });
    world.holds.push({
      traderId,
      holdRef: hold.holdId,
      amountCents: amount,
      capturedCents: 0,
      status: hold.status,
      createdAt: new Date(now().getTime() - 1_000 * (10 - world.holds.length)).toISOString(),
      custodyCapturedAt: null,
    });
  };
  await place(INITIATOR, options.holdAmounts?.initiator === undefined ? 50_000 : options.holdAmounts.initiator);
  await place(COUNTERPART, options.holdAmounts?.counterpart === undefined ? 50_000 : options.holdAmounts.counterpart);

  const tradeRepository: TradeRepository = {
    async loadTrade() {
      return { ...world.trade };
    },
    async commitTransition({ expectedVersion, nextState }) {
      if (world.trade.version !== expectedVersion) return null;
      world.trade = { ...world.trade, state: nextState, version: expectedVersion + 1 };
      return { ...world.trade };
    },
    async insertTransition(audit: TransitionAudit) {
      if (world.dropAuditRows) return;
      world.transitions.push({ from: audit.fromState, to: audit.toState, event: audit.event, by: audit.requestedBy });
    },
  };

  const repository: DisputeResolutionRepository = {
    async loadTrade() {
      return { ...world.trade };
    },
    async getHolds() {
      return world.holds.map((h) => ({ ...h }));
    },
    async hasReachedInspection() {
      if (world.historyFails) throw new Error('history read failed');
      return Boolean(world.trade.inspection_deadline_at) || world.transitions.some((t) => t.to === 'INSPECTION');
    },
    async disbursedFromHold(holdRef) {
      let settledCents = 0;
      let queuedCents = 0;
      for (const d of world.disbursements.filter((x) => x.holdRef === holdRef)) {
        if (d.status === 'SETTLED') settledCents += d.amountMinor;
        else queuedCents += d.amountMinor;
      }
      return { settledCents, queuedCents };
    },
    async recordDisputeParticipants(p) {
      world.trade = { ...world.trade, dispute_raised_by: p.raisedBy, disputed_against: p.disputedAgainst };
    },
    async recordFraudClaim(p) {
      world.fraudClaims.push({ claimantId: p.claimantId, reason: p.reason });
      return true;
    },
    async recordHoldCapture(p) {
      world.holds = world.holds.map((h) =>
        h.holdRef === p.holdRef
          ? { ...h, status: p.status, capturedCents: p.capturedCents, custodyCapturedAt: p.custodyCapturedAt.toISOString() }
          : h,
      );
    },
    async markHoldVoided(ref) {
      world.holds = world.holds.map((h) => (h.holdRef === ref ? { ...h, status: 'VOIDED' } : h));
    },
    async queueDisbursements(rows) {
      for (const row of rows) {
        if (world.disbursements.some((d) => d.nonce === row.nonce)) continue;
        world.disbursements.push({
          ...row,
          id: `disb-${world.disbursements.length + 1}`,
          status: 'PENDING',
          releaseAt: null,
          attempts: 0,
          createdAt: now().toISOString(),
        });
      }
    },
    async insertCustodyAudit() {
      world.transitions.push({ from: 'DISPUTED', to: 'DISPUTED', event: 'COLLATERAL_TAKEN_INTO_CUSTODY', by: null });
    },
    async recordOutcome(p) {
      world.outcome = { outcome: p.outcome, attestedBy: p.attestedBy, cancelled: p.cancelled };
    },
    async recordFraudParticipants(p) {
      world.trade = { ...world.trade, fraud_victim_id: p.victimId };
    },
    async incrementUnfoundedDisputeCount(id) {
      world.unfounded[id] = (world.unfounded[id] ?? 0) + 1;
    },
    async flagManualReconciliation(p) {
      world.manualReconciliation = true;
      if (p.fullCaptureFailed) world.fullCaptureFailed = true;
    },
    async restoreTradeItemsIfUnclaimed() {
      const restored: string[] = [];
      world.items = world.items.map((item) => {
        if (item.status === 'RESERVED' && item.listingKind === 'SINGLE' && !item.claimedElsewhere) {
          restored.push(item.id);
          return { ...item, status: 'AVAILABLE' };
        }
        return item;
      });
      world.calls.restored.push(restored);
      return restored;
    },
  };

  const cashLeg: TradeCashLegPort = {
    async settleForOutcome(_tradeId, outcome) {
      world.calls.cashLeg.push(outcome);
      return { manualReconciliation: outcome === 'FRAUD' };
    },
  };

  const notifier: DisputeNotifier = {
    async custodyCaptured(p) {
      world.calls.notifications.push(`custody:${p.ownerId}`);
    },
    async tradeUnwound(p) {
      world.calls.notifications.push(`unwound:${p.traderIds.join(',')}`);
    },
    async listingsRestored(p) {
      world.calls.notifications.push(`restored:${p.itemIds.join(',')}`);
    },
  };

  const deps: DisputeResolutionDeps = {
    orchestrator: createTradeOrchestrator({ repository: tradeRepository, now }),
    repository,
    payments: options.payments,
    cashLeg,
    refundFees: async (tradeId) => {
      world.calls.refundFees.push(tradeId);
      return { ok: true };
    },
    notifier,
    now,
  };

  const drain = async (payees: Record<string, MerchantRecord> = {}) => {
    const disbursementRepo: CollateralDisbursementRepository = {
      async listDue() {
        return world.disbursements
          .filter((d) => (d.status === 'PENDING' || d.status === 'FAILED') && !d.holdReason)
          .map(
            (d): CollateralDisbursementRow => ({
              id: d.id,
              tradeId: d.tradeId,
              holdRef: d.holdRef,
              kind: d.kind,
              payeeId: d.payeeId,
              amountMinor: d.amountMinor,
              currency: d.currency,
              nonce: d.nonce,
              status: d.status,
              releaseAt: null,
              holdReason: null,
              attempts: d.attempts,
              lastError: null,
              failureNotifiedAt: null,
              createdAt: d.createdAt,
            }),
          );
      },
      async loadReleaseFacts(row) {
        // Drained "now" for the test, as if the holdback had passed.
        return {
          source: 'CAPTURED_COLLATERAL',
          currency: row.currency,
          qualifyingCompletedSales: 0,
          paymentSettledAt: null,
          capturedAt: '2000-01-01T00:00:00.000Z',
          openChargeDispute: false,
          openFraudWarning: false,
          staffHold: false,
        };
      },
      async getPayee(id) {
        return payees[id] ?? payable(id);
      },
      async markSettled({ id }) {
        world.disbursements = world.disbursements.map((d) => (d.id === id ? { ...d, status: 'SETTLED' } : d));
      },
      async markFailed({ id, countAttempt }) {
        world.disbursements = world.disbursements.map((d) =>
          d.id === id ? { ...d, status: 'FAILED', attempts: d.attempts + (countAttempt ? 1 : 0) } : d,
        );
      },
      async recordDeferral() {},
      async markFailureNotified() {},
    };
    await processDueCollateralDisbursements({
      repository: disbursementRepo,
      payments: options.payments,
      currency: String(world.trade.currency),
      now,
    });
  };

  return { world, repository, coordinator: createDisputeResolutionOrchestrator(deps), deps, drain };
}

export function payable(profileId: string): MerchantRecord {
  return {
    profileId,
    merchantRef: `acct_${profileId}`,
    merchantStatus: 'APPROVED',
    liveEnabled: true,
    transactionsEnabled: true,
    settlementsEnabled: true,
    fraudBannedAt: null,
  };
}

/** The hold row a trader currently has in the world. */
export function holdOf(world: DisputeWorld, traderId: string): DisputeHold {
  const hold = [...world.holds].reverse().find((h) => h.traderId === traderId);
  if (!hold) throw new Error(`no hold for ${traderId}`);
  return hold;
}
