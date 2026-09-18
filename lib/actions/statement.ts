'use server';

// lib/actions/statement.ts
//
// Server binding for the Account_Statement — every movement of money on the
// signed-in member's account, both directions. See `domain/statement`.
//
// THIN BY DESIGN, like `payouts.ts`: authenticate, read, redact, delegate the
// arithmetic to `deriveAccountStatement`. No money logic lives here.
//
// SCOPING. The member comes from the session and nothing else; no exported
// function takes an id. Every table is read on the COOKIE-BOUND client so RLS
// applies (`cash_sales_participant_select`, `trade_fees_participant_select`,
// `holds_participant_select`, `charge_disputes_member_select`), and the
// "mine" filter is applied explicitly on top — authorisation twice, per the
// project convention.
//
// WHAT IS NOT RETURNED. Provider references (`transfer_id`, `refund_ref`,
// `hold_ref`, `charge_ref`), nonces, raw error strings and retry counts are never
// selected. The statement says what happened and where it stands, in the
// member's own terms.

import { createClient } from '@/lib/supabase/server';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import {
  deriveAccountStatement,
  type AccountStatement,
  type CashSaleStatus,
  type HoldStatus,
  type PayoutStatus,
  type StatementCashSaleInput,
  type StatementChargebackInput,
  type StatementHoldInput,
  type StatementRestitutionInput,
  type StatementTradeFeeInput,
  type TradeFeeStatus,
} from '@/domain/statement/accountStatement';
import { FRICTION_TAX_RETURN_SHIPPING_CENTS } from '@/domain/dispute/frictionTax';
import { type ActionResult, fail, ok } from './result';

export type StatementActionError = 'not-authenticated' | 'read-failed';

/**
 * Load the Account_Statement for the signed-in member.
 *
 * A read failure is reported as `read-failed` so the page can offer a retry
 * rather than rendering an empty statement, which would read as "nothing has
 * ever happened".
 */
export async function getAccountStatement(): Promise<
  ActionResult<AccountStatement, StatementActionError>
> {
  const supabase = await createClient();
  const user = await getCachedAuthUser();
  if (!user) return fail('not-authenticated', 'You must be signed in to view your statement.');
  const me = user.id;

  // FOUR INDEPENDENT READS, ONE ROUND TRIP. Each select string is a single
  // literal so Supabase can infer the row type from it.
  const [
    { data: salesData, error: salesError },
    { data: feesData, error: feesError },
    { data: tradesData, error: tradesError },
    { data: chargebacksData },
  ] = await Promise.all([
    // Both sides. RLS scopes to contracts I participate in; the `.or` is the
    // explicit second guard and lets the row say which side I am on.
    supabase
      .from('cash_sales')
      .select(
        'id, item_title, status, buyer_id, seller_id, amount_cents, agreed_price_cents, platform_fee_cents, shipping_cost_cents, refund_cents, refund_status, seller_payout_status, payment_settled_at, seller_payout_at, completed_at, updated_at',
      )
      .or(`buyer_id.eq.${me},seller_id.eq.${me}`),
    // My side of each trade's fee. Never the counterparty's.
    supabase
      .from('trade_fees')
      .select('trade_id, amount_cents, status, settled_at, created_at')
      .eq('trader_id', me),
    // Trades I am party to, for counterparty names, my holds, and any money a
    // resolution paid to me.
    supabase
      .from('trades')
      .select(
        'id, initiator_id, counterpart_id, state, fraud_victim_id, dispute_raised_by, disputed_against, friction_tax_return_cents, friction_tax_return_paid_at, updated_at',
      )
      .or(`initiator_id.eq.${me},counterpart_id.eq.${me}`),
    // Chargebacks against me. Column privileges (0040) already restrict this to
    // the member-safe projection.
    supabase
      .from('charge_disputes')
      .select('id, amount_cents, outcome, opened_at, closed_at, cash_sale_id, trade_id')
      .eq('profile_id', me),
  ]);

  if (salesError || feesError || tradesError) {
    return fail('read-failed', 'We could not load your statement right now.');
  }

  const saleRows = salesData ?? [];
  const tradeRows = tradesData ?? [];
  const tradeIds = tradeRows.map((t) => t.id as string);

  // Everyone I have dealt with, resolved to a display name in one read.
  const counterpartyIds = new Set<string>();
  for (const s of saleRows) counterpartyIds.add((s.buyer_id === me ? s.seller_id : s.buyer_id) as string);
  for (const t of tradeRows) {
    counterpartyIds.add((t.initiator_id === me ? t.counterpart_id : t.initiator_id) as string);
  }

  const [{ data: profilesData }, holdsData] = await Promise.all([
    counterpartyIds.size > 0
      ? supabase.from('public_profiles').select('id, display_name').in('id', [...counterpartyIds])
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    // `holds_participant_select` scopes to trades I am party to; the trader filter
    // keeps the statement to MY collateral. The counterparty's hold is theirs.
    tradeIds.length > 0
      ? supabase
          .from('pre_auth_holds')
          .select('id, trade_id, amount_cents, captured_cents, status, created_at, updated_at')
          .in('trade_id', tradeIds)
          .eq('trader_id', me)
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
  ]);

  const nameById = new Map<string, string | null>(
    (profilesData ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? null]),
  );
  const tradeById = new Map(tradeRows.map((t) => [t.id as string, t]));
  const tradeCounterparty = (tradeId: string): string | null => {
    const t = tradeById.get(tradeId);
    if (!t) return null;
    const other = (t.initiator_id === me ? t.counterpart_id : t.initiator_id) as string;
    return nameById.get(other) ?? null;
  };

  const sales: StatementCashSaleInput[] = saleRows.map((row) => {
    const iAmBuyer = row.buyer_id === me;
    const other = (iAmBuyer ? row.seller_id : row.buyer_id) as string;
    return {
      id: row.id as string,
      itemTitle: (row.item_title as string | null) ?? 'Untitled item',
      status: row.status as CashSaleStatus,
      iAmBuyer,
      counterpartyName: nameById.get(other) ?? null,
      amountCents: Number(row.amount_cents ?? 0),
      agreedPriceCents: Number(row.agreed_price_cents ?? 0),
      platformFeeCents: Number(row.platform_fee_cents ?? 0),
      shippingCostCents: Number(row.shipping_cost_cents ?? 0),
      refundCents: Number(row.refund_cents ?? 0),
      refundStatus: (row.refund_status ?? 'NOT_DUE') as PayoutStatus,
      sellerPayoutStatus: (row.seller_payout_status ?? 'NOT_DUE') as PayoutStatus,
      paymentSettledAt: (row.payment_settled_at as string | null) ?? null,
      sellerPayoutAt: (row.seller_payout_at as string | null) ?? null,
      completedAt: (row.completed_at as string | null) ?? null,
      updatedAt: row.updated_at as string,
    };
  });

  const tradeFees: StatementTradeFeeInput[] = (feesData ?? []).map((row) => ({
    tradeId: row.trade_id as string,
    counterpartyName: tradeCounterparty(row.trade_id as string),
    amountCents: Number(row.amount_cents ?? 0),
    status: row.status as TradeFeeStatus,
    settledAt: (row.settled_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }));

  const holds: StatementHoldInput[] = holdsData.map((row) => ({
    id: row.id as string,
    tradeId: row.trade_id as string,
    counterpartyName: tradeCounterparty(row.trade_id as string),
    amountCents: Number(row.amount_cents ?? 0),
    capturedCents: Number(row.captured_cents ?? 0),
    status: row.status as HoldStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));

  // Money a resolution paid TO me. Fraud restitution is the other party's whole
  // captured collateral; the return-shipping share is the $10 the RAISER of a
  // condition dispute receives once the friction tax settles. The counterparty's
  // capture figure is not in my holds, so it is read from the trade's own
  // friction-tax columns and, for fraud, from the counterparty's hold — which
  // `holds_participant_select` lets a participant read.
  const restitutions: StatementRestitutionInput[] = [];
  const fraudTradeIds = tradeRows
    .filter((t) => t.state === 'FRAUD_RESOLVED' && t.fraud_victim_id === me)
    .map((t) => t.id as string);
  const counterpartCaptured =
    fraudTradeIds.length > 0
      ? await supabase
          .from('pre_auth_holds')
          .select('trade_id, captured_cents, updated_at')
          .in('trade_id', fraudTradeIds)
          .neq('trader_id', me)
          .then(({ data }) => data ?? [])
      : [];
  for (const h of counterpartCaptured) {
    const captured = Number(h.captured_cents ?? 0);
    if (captured <= 0) continue;
    restitutions.push({
      tradeId: h.trade_id as string,
      counterpartyName: tradeCounterparty(h.trade_id as string),
      amountCents: captured,
      reason: 'FRAUD',
      paidAt: h.updated_at as string,
    });
  }
  for (const t of tradeRows) {
    if (t.dispute_raised_by === me && t.friction_tax_return_paid_at) {
      restitutions.push({
        tradeId: t.id as string,
        counterpartyName: tradeCounterparty(t.id as string),
        amountCents: Number(t.friction_tax_return_cents ?? FRICTION_TAX_RETURN_SHIPPING_CENTS),
        reason: 'RETURN_SHIPPING',
        paidAt: t.friction_tax_return_paid_at as string,
      });
    }
  }

  const saleTitleById = new Map(sales.map((s) => [s.id, s.itemTitle]));
  const chargebacks: StatementChargebackInput[] = (chargebacksData ?? []).map((row) => {
    const cashSaleId = (row.cash_sale_id as string | null) ?? null;
    const tradeId = (row.trade_id as string | null) ?? null;
    return {
      id: row.id as string,
      amountCents: Number(row.amount_cents ?? 0),
      outcome: (row.outcome as string | null) ?? null,
      openedAt: row.opened_at as string,
      closedAt: (row.closed_at as string | null) ?? null,
      cashSaleId,
      tradeId,
      label: cashSaleId
        ? (saleTitleById.get(cashSaleId) ?? 'Sale')
        : tradeId
          ? `Trade with ${tradeCounterparty(tradeId) ?? 'a member'}`
          : 'Payment',
    };
  });

  return ok(deriveAccountStatement({ sales, tradeFees, holds, restitutions, chargebacks }));
}
