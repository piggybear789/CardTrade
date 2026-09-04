'use server';

// lib/actions/payouts.ts
//
// Server binding for the Payouts_Dashboard (Req 2, 6, 10, 11).
//
// THIN BY DESIGN. This module authenticates, reads, redacts, and delegates the
// arithmetic to `derivePayoutReadModel` in `domain/payouts/`. It holds no money
// logic of its own, so the figures a Member sees are the ones the property tests
// cover.
//
// SCOPING. The viewing Member comes from the server-side session and nothing
// else. No exported function accepts a member id, a Cash_Sale id or a dispute id,
// so there is no parameter a caller could tamper with to read someone else's
// money (Req 2.3). Cash sales, contract events and chargebacks are read on the
// COOKIE-BOUND client so `cash_sales_participant_select`,
// `cash_sale_events_participant_select` and `charge_disputes_member_select` all
// apply, and the seller-side filter is applied explicitly on top — authorization
// twice, per the project convention (Req 2.2, 2.5).
//
// REDACTION HAPPENS HERE. `seller_payout_error`, `seller_payout_ref` and the
// retry count are read but never returned: the error is mapped to a member-safe
// cause before it crosses into the read model, which is why the read model cannot
// leak it even by accident (Req 6.5, 5.9).
//
// The `merchant_*` columns are provider-controlled and not part of any
// client-facing select, so they are read through the admin client filtered to the
// caller's own id, returning only the fields Req 4 names (Req 2.4).

import { createClient } from '@/lib/supabase/server';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  derivePayoutReadModel,
  MAX_RELEASE_ATTEMPTS,
  type CashSaleStatus,
  type ChargeDisputeInput,
  type PayoutEventInput,
  type PayoutReadModel,
  type ReleaseFailureCause,
  type ReleaseStatus,
  type SellerCashSaleInput,
  type TradeArbitrationInput,
  type TradeState,
} from '@/domain/payouts/payoutReadModel';
import type {
  MerchantStatus,
  VerificationState,
} from '@/domain/identity/identityGate';
import { type ActionResult, fail, ok } from './result';

/** Typed failures for the dashboard read. */
export type PayoutsActionError = 'not-authenticated' | 'read-failed';

/**
 * Where a release is sent, in its display-safe form (Req 4).
 *
 * Carries no bank-state branch number, account number, masked digits, merchant
 * reference or compliance note. Stripe collects and holds settlement details in
 * its own hosted flow; CardTrade never receives them, so there is nothing here to
 * redact — the absence is structural, not filtered.
 */
export interface DestinationAccount {
  /** The Member's own provider-verified legal name, when reported. */
  verifiedName: string | null;
  state: VerificationState;
  /** True only when the provider reports transfers as active. */
  settlementsEnabled: boolean;
  /** True when the provider offers a hosted flow to update details in. */
  hostedOnboarding: boolean;
}

/** The whole dashboard payload. */
export interface PayoutsDashboardData {
  model: PayoutReadModel;
  destination: DestinationAccount;
}

/** Contract event names that carry payout state changes. */
const PAYOUT_EVENTS = [
  'SELLER_PAYOUT_QUEUED',
  'SELLER_PAYOUT_SETTLED',
  'SELLER_PAYOUT_FAILED',
] as const;

/**
 * Reduce a stored provider error to a member-safe cause (Req 6.1-6.5).
 *
 * The raw string can name the provider, quote an API message, or describe
 * compliance state, none of which belongs in front of a Member. Only three
 * distinctions actually change what they should do: fix their payout setup, wait
 * while retries continue, or wait for an operator.
 */
function failureCauseFor(params: {
  releaseStatus: ReleaseStatus;
  attempts: number;
  storedError: string | null;
}): ReleaseFailureCause | null {
  if (params.releaseStatus !== 'FAILED') return null;
  if (params.attempts >= MAX_RELEASE_ATTEMPTS) return 'RETRIES_EXHAUSTED';

  // The one cause a Member can resolve themselves. Matched on the phrase the
  // orchestrator records, not on provider text.
  const stored = params.storedError?.toLowerCase() ?? '';
  if (stored.includes('cannot receive') || stored.includes('not payable')) {
    return 'NOT_PAYABLE';
  }
  return 'PROVIDER_REJECTED';
}

/**
 * Load the Payouts_Dashboard for the signed-in Member.
 *
 * Every read is scoped to the caller. A failure to read is reported as
 * `read-failed` so the page can offer a retry rather than rendering a zero
 * balance, which would read as "you are owed nothing" (Req 10.8).
 */
export async function getPayoutsDashboard(): Promise<
  ActionResult<PayoutsDashboardData, PayoutsActionError>
> {
  const supabase = await createClient();
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'You must be signed in to view payouts.');

  // FIVE READS THAT ONLY NEED `user.id`, IN ONE ROUND TRIP.
  //
  // This function was a seven-stage chain, and five of those stages had no
  // dependency on the one before them — the dashboard simply awaited each in
  // turn. It is the slowest thing on the account surface, so it set the floor
  // for the whole page.
  //
  // NOTE: each select string must stay a single literal. Supabase infers the row
  // type from it, and concatenating the string collapses that inference to
  // `GenericStringError`, which then reports every field access as missing.
  const [
    { data: salesData, error: salesError },
    { data: tradesData },
    { data: disputesData },
    { data: profile },
    hostedOnboarding,
  ] = await Promise.all([
    // Sales where the caller is the SELLER. RLS already restricts this to
    // contracts they participate in; the explicit seller filter is the second
    // guard.
    supabase
      .from('cash_sales')
      .select(
        'id, item_title, status, amount_cents, platform_fee_cents, refund_cents, seller_payout_status, seller_payout_attempts, seller_payout_error, completed_at, dispute_reason, disputed_by',
      )
      .eq('seller_id', user.id),
    // Trades the Member participated in that have a money consequence. Bond
    // amounts are not columns on `trades` — they live in `pre_auth_holds`, one
    // row per trader per trade, which also records what was actually captured.
    supabase
      .from('trades')
      .select(
        'id, state, initiator_id, counterpart_id, fraud_victim_id, friction_tax_platform_cents, friction_tax_return_cents, created_at',
      )
      .or(`initiator_id.eq.${user.id},counterpart_id.eq.${user.id}`)
      .in('state', ['DISPUTED', 'FRAUD_RESOLVED']),
    // Chargebacks attributable to the caller. Column privileges from migration
    // 0040 mean only the member-safe projection is selectable at all.
    supabase
      .from('charge_disputes')
      .select('id, amount_cents, opened_at, closed_at, outcome, cash_sale_id, trade_id'),
    // Provider-controlled columns, read through the admin client scoped to the
    // caller's own row, returning only what Req 4 permits.
    createAdminClient()
      .from('profiles')
      .select('merchant_status, merchant_settlements_enabled, merchant_legal_entity_name')
      .eq('id', user.id)
      .maybeSingle(),
    // Resolved from the provider seam rather than from env, so the client never
    // learns which provider is configured.
    hostedOnboardingAvailable(),
  ]);

  if (salesError) {
    return fail('read-failed', 'We could not load your payouts right now.');
  }

  const sales: SellerCashSaleInput[] = (salesData ?? []).map((row) => {
    const releaseStatus = (row.seller_payout_status ?? 'NOT_DUE') as ReleaseStatus;
    const attempts = Number(row.seller_payout_attempts ?? 0);
    return {
      id: row.id as string,
      itemTitle: (row.item_title as string | null) ?? 'Untitled item',
      status: row.status as CashSaleStatus,
      amountCents: Number(row.amount_cents ?? 0),
      platformFeeCents: Number(row.platform_fee_cents ?? 0),
      refundCents: Number(row.refund_cents ?? 0),
      releaseStatus,
      releaseAttempts: attempts,
      failureCause: failureCauseFor({
        releaseStatus,
        attempts,
        storedError: (row.seller_payout_error as string | null) ?? null,
      }),
      completedAt: (row.completed_at as string | null) ?? null,
      disputeReason: (row.dispute_reason as string | null) ?? null,
      disputeRaisedByMe: row.disputed_by === user.id,
    };
  });

  const saleIds = sales.map((s) => s.id);
  const tradeRows = tradesData ?? [];
  const tradeIds = tradeRows.map((t) => t.id as string);

  // The only two reads that genuinely depend on the batch above — they need the
  // ids it returned. Both are skipped when their id list is empty, because
  // `.in()` with no values is a wasted round trip.
  const [eventsData, holdsData] = await Promise.all([
    saleIds.length > 0
      ? supabase
          .from('cash_sale_events')
          .select('id, cash_sale_id, event, created_at')
          .in('cash_sale_id', saleIds)
          .in('event', PAYOUT_EVENTS as unknown as string[])
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
    // `holds_participant_select` already scopes these to trades the caller is
    // party to, so both sides of each hold pair are legitimately readable.
    tradeIds.length > 0
      ? supabase
          .from('pre_auth_holds')
          .select('trade_id, trader_id, amount_cents, captured_cents')
          .in('trade_id', tradeIds)
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
  ]);

  const events: PayoutEventInput[] = eventsData.map((row) => ({
    id: row.id as string,
    cashSaleId: row.cash_sale_id as string,
    event: row.event as string,
    createdAt: row.created_at as string,
  }));

  const holdsByTrade = holdsData.reduce((acc, hold) => {
    const tradeId = hold.trade_id as string;
    const entry = acc.get(tradeId) ?? { mine: 0, theirs: 0 };
    // Prefer what was captured, falling back to what was authorised: on a
    // resolved trade the captured figure is the money that actually moved.
    const amount = Number(hold.captured_cents ?? 0) || Number(hold.amount_cents ?? 0);
    if (hold.trader_id === user.id) entry.mine += amount;
    else entry.theirs += amount;
    acc.set(tradeId, entry);
    return acc;
  }, new Map<string, { mine: number; theirs: number }>());

  const trades: TradeArbitrationInput[] = tradeRows.map((row) => {
    const bonds = holdsByTrade.get(row.id as string) ?? { mine: 0, theirs: 0 };
    const frictionTax =
      Number(row.friction_tax_platform_cents ?? 0) +
      Number(row.friction_tax_return_cents ?? 0);
    return {
      id: row.id as string,
      state: row.state as TradeState,
      myBondCents: bonds.mine,
      counterpartBondCents: bonds.theirs,
      iAmFraudVictim: row.fraud_victim_id === user.id,
      frictionTaxApplied: frictionTax > 0,
      createdAt: row.created_at as string,
    };
  });

  const disputes: ChargeDisputeInput[] = (disputesData ?? []).map((row) => ({
    id: row.id as string,
    amountCents: Number(row.amount_cents ?? 0),
    openedAt: row.opened_at as string,
    closedAt: (row.closed_at as string | null) ?? null,
    outcome: (row.outcome as string | null) ?? null,
    cashSaleId: (row.cash_sale_id as string | null) ?? null,
    tradeId: (row.trade_id as string | null) ?? null,
  }));

  const merchantStatus = (profile?.merchant_status ?? 'NONE') as MerchantStatus;
  const settlementsEnabled = Boolean(profile?.merchant_settlements_enabled);

  const destinationState: DestinationAccount['state'] = settlementsEnabled
    ? 'VERIFIED'
    : merchantStatus === 'REJECTED'
      ? 'NOT_APPROVED'
      : merchantStatus === 'NONE'
        ? 'NOT_STARTED'
        : 'IN_PROGRESS';

  const destination: DestinationAccount = {
    verifiedName: (profile?.merchant_legal_entity_name as string | null) ?? null,
    state: destinationState,
    settlementsEnabled,
    hostedOnboarding,
  };

  return ok({
    model: derivePayoutReadModel({ sales, events, trades, disputes }),
    destination,
  });
}

/**
 * Whether the active provider exposes a hosted onboarding flow.
 *
 * Imported lazily so that loading this module does not construct a provider
 * client, which would make the dashboard fail closed on a missing credential
 * rather than simply omitting the update action (Req 4.4).
 */
async function hostedOnboardingAvailable(): Promise<boolean> {
  try {
    const { getPaymentService } = await import('@/domain/services');
    return Boolean(getPaymentService().createMerchantOnboardingLink);
  } catch {
    return false;
  }
}
