// lib/api/contractStepPlan.ts
//
// The contract step plan, resolved for one viewer and shaped for the wire
// (`.kiro/specs/mobile-parity/` Requirement 11).
//
// WHAT THIS IS AND IS NOT. It is an ADAPTER: it reads the contract row the caller is a
// party to, maps its columns onto the fact interfaces the web contract room already
// fills in, calls `deriveCashSaleSteps` / `deriveTradeSteps` — the same modules
// `CashSaleView` and `TradeContract` call — and serialises the result. It decides no
// step, no ordering and no halted rule (Req 11.2). Every sentence the client renders
// was written in `domain/contract/`, including the interpolated counterparty name.
//
// WHY THE PLAN IS SERVED AT ALL. Both Flutter contract rooms used to carry their own
// column labels and their own state→column map, so a phone told a member how far their
// contract had progressed from a plan the server never agreed to; a new Trade_State or
// Cash_Sale_Status shipped as a silently mis-drawn room. The alternatives were a ninth
// Dart domain port (forbidden by `.kiro/steering/flutter.md` and by mobile-visual-parity
// Req 14.1) or a generated lookup table over 13 statuses × 2 roles × eight flags with
// interpolated names, which is a re-implementation wearing a table's clothes. So the
// answer comes down with the data.
//
// TWO FUNCTIONS, NOT ONE. A Cash_Sale and a Trade are different state machines with
// different fact interfaces, different tables and different id columns, and the two
// derivations share nothing but the step vocabulary. One entry point would have to
// branch on a `kind` discriminator before it could read anything — a decision in the
// transport layer, which is the thing this file exists not to hold. It also matches
// every other handler under `app/api/mobile/`: one area, one action.
//
// AUTHORISATION IS ENFORCED TWICE, as `.kiro/steering/structure.md` requires: the
// caller's own RLS-bound client performs the read, AND the participant check below is
// explicit. A plan names the counterparty and quotes the contract's terms, so a
// non-party must not receive one even if a policy is later loosened.

import 'server-only';

import type { createServerClient } from '@supabase/ssr';

import {
  deriveCashSaleSteps,
  deriveTradeSteps,
  isCashSaleStatus,
  isTradeState,
  type ContractStep,
} from '@/domain/contract';
import type { CashSaleStatus } from '@/domain/orchestrator/cashSaleOrchestrator';
import { deriveHoldLegs } from '@/domain/state-machine/holdLegs';
import { factsFromTrade, type TradeRow } from '@/lib/actions/tradeLifecycleStore';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { CASH_SALE_PUBLIC_SELECT } from '@/lib/supabase/cashSaleProjection';
import type { Database, Tables } from '@/lib/supabase/database.types';

/** A Supabase client already bound to the calling member, cookie or bearer. */
type CallerClient = ReturnType<typeof createServerClient<Database>>;

/**
 * How far a contract has got through one step, in the four values a rail can draw.
 *
 * The derivation distinguishes five — it also reports `blocked`, the live step that
 * cannot start because a prerequisite outside the sequence is missing. Both `blocked`
 * and `upcoming` arrive as `pending`, and that collapse happens HERE rather than on the
 * client: a blocked step has not been reached, no control on it would work, and leaving
 * the distinction on the wire would make the phone decide how to draw a state it has no
 * marker for.
 */
export type WireStepStatus = 'done' | 'active' | 'pending' | 'halted';

/** One step of a served plan. Every field is already resolved for rendering. */
export interface WireStep {
  /** Stable within a plan; the client tracks which column is disclosed by it. */
  id: string;
  /**
   * The label for a rail column — two words at most, already chosen.
   *
   * The derivation's `short` where it has one, the full `label` otherwise. The web rail
   * renders an EMPTY `short` as a blank column on purpose (its terminal ticks), which a
   * phone cannot copy: the marker's accessible name is built from this string, and an
   * unnamed button is not reachable. So an empty `short` falls back here.
   */
  railLabel: string;
  /** The whole sentence, for the disclosure a member opens by tapping the column. */
  label: string;
  /** One line of context, with any counterparty name already interpolated. */
  detail: string | null;
  /** Whose move this step is: `you`, `them`, `both`, or `platform`. */
  owner: string;
  status: WireStepStatus;
}

/** The plan for one contract as one viewer sees it. */
export interface WireStepPlan {
  /** The contract this plan is for, echoed so a late response can be discarded. */
  contractId: string;
  /** The status or state the plan was derived from, as the server holds it. */
  contractStatus: string;
  /** The other party's display name, as it appears in the detail lines. */
  counterpartyName: string;
  steps: WireStep[];
}

/** Why a plan could not be produced. Never a partial plan — see Req 11.5. */
export type StepPlanError =
  | 'NOT_AUTHENTICATED'
  | 'NOT_FOUND'
  | 'NOT_A_PARTICIPANT'
  | 'STATUS_NOT_RECOGNISED';

export type StepPlanResult = ActionResult<WireStepPlan, StepPlanError>;

/** Collapse the derivation's five statuses onto the four a rail can draw. */
function wireStatus(step: ContractStep): WireStepStatus {
  switch (step.status) {
    case 'done':
      return 'done';
    case 'active':
      return 'active';
    case 'halted':
      return 'halted';
    // `blocked` and `upcoming` are both "not reached". See WireStepStatus.
    default:
      return 'pending';
  }
}

/** Serialise the derivation's output. Nothing is reordered, dropped or renamed. */
function toWire(steps: ContractStep[]): WireStep[] {
  return steps.map((step) => ({
    id: step.id,
    railLabel: step.short?.trim() ? step.short.trim() : step.label,
    label: step.label,
    detail: step.detail?.trim() ? step.detail.trim() : null,
    owner: step.owner,
    status: wireStatus(step),
  }));
}

/**
 * The other party's display name, or a neutral stand-in.
 *
 * `public_profiles` is the only place a counterparty's name may be read from, and the
 * fallback matters: the name is interpolated into detail lines, so a missing profile
 * must produce a readable sentence rather than the word `null` in the middle of one.
 */
async function counterpartyNameFor(
  supabase: CallerClient,
  profileId: string,
): Promise<string> {
  const { data } = await supabase
    .from('public_profiles')
    .select('display_name')
    .eq('id', profileId)
    .maybeSingle();
  const name = data?.display_name?.trim();
  return name && name.length > 0 ? name : 'the other party';
}

/** Statuses a Cash_Sale can only be in after it has ended. */
const CASH_SALE_TERMINAL = new Set(['CANCELLED', 'FAILED', 'REFUNDED']);

/**
 * The step plan for a Cash_Sale the caller is a party to.
 *
 * The fact mapping is `CashSaleView`'s, column for column. `haltedAt` is read from the
 * audit trail exactly as the web room reads it — the `from_status` of the event that
 * moved the sale into its terminal status — so a cancelled sale marks the step it really
 * died at instead of the conservative guess the derivation falls back to.
 */
export async function cashSaleStepPlan(
  supabase: CallerClient,
  userId: string,
  cashSaleId: string,
): Promise<StepPlanResult> {
  if (!cashSaleId) {
    return fail('NOT_FOUND', 'That contract could not be found.');
  }

  // Cast as the sale page does: `CASH_SALE_PUBLIC_SELECT` is a joined string, so
  // supabase-js cannot infer the projected row shape from it.
  const { data } = await supabase
    .from('cash_sales')
    .select(CASH_SALE_PUBLIC_SELECT)
    .eq('id', cashSaleId)
    .maybeSingle();
  const sale = data as Tables<'cash_sales'> | null;

  if (!sale) {
    return fail('NOT_FOUND', 'That contract could not be found.');
  }

  const iAmBuyer = sale.buyer_id === userId;
  const iAmSeller = sale.seller_id === userId;
  if (!iAmBuyer && !iAmSeller) {
    return fail('NOT_A_PARTICIPANT', 'You are not a party to that contract.');
  }

  const status: unknown = sale.status;
  if (!isCashSaleStatus(status)) {
    // Refusing beats guessing: the client presents the neutral room (Req 11.5).
    return fail(
      'STATUS_NOT_RECOGNISED',
      'This contract is in a state this app cannot describe yet.',
    );
  }

  // Where a closed sale stopped, from the trail rather than inferred.
  let haltedAt: CashSaleStatus | null = null;
  if (CASH_SALE_TERMINAL.has(status)) {
    const { data: events } = await supabase
      .from('cash_sale_events')
      .select('from_status, to_status, created_at')
      .eq('cash_sale_id', cashSaleId)
      .order('created_at', { ascending: true });
    const trail = events ?? [];
    for (let i = trail.length - 1; i >= 0; i -= 1) {
      const from: unknown = trail[i].from_status;
      if (trail[i].to_status === status && isCashSaleStatus(from)) {
        haltedAt = from;
        break;
      }
    }
  }

  const counterpartyName = await counterpartyNameFor(
    supabase,
    iAmBuyer ? sale.seller_id : sale.buyer_id,
  );

  const steps = deriveCashSaleSteps({
    status,
    viewerRole: iAmBuyer ? 'BUYER' : 'SELLER',
    counterpartyName,
    termsSet: sale.fulfillment_method !== null,
    termsVersion: sale.terms_version,
    isDelivery: sale.fulfillment_method === 'DELIVERY',
    hasTracking: Boolean(sale.tracking_number),
    myHandoverConfirmed: Boolean(
      iAmBuyer ? sale.buyer_handover_confirmed_at : sale.seller_handover_confirmed_at,
    ),
    theirHandoverConfirmed: Boolean(
      iAmBuyer ? sale.seller_handover_confirmed_at : sale.buyer_handover_confirmed_at,
    ),
    disputeRaisedByMe: sale.disputed_by === userId,
    hasReturnTracking: Boolean(sale.return_tracking_number),
    returnDisputed: Boolean(sale.return_disputed_at),
    haltedAt,
  });

  return ok({
    contractId: sale.id,
    contractStatus: status,
    counterpartyName,
    steps: toWire(steps),
  });
}

/**
 * The step plan for a Trade the caller is a party to.
 *
 * The facts come from `factsFromTrade` — the same mapping the lifecycle writes use —
 * with the two hold-derived legs overlaid from `deriveHoldLegs`, because that mapping
 * defaults them to false and the room's collateral copy and release step depend on them.
 * The address legs read the row's own `*_delivery_address_configured` flags rather than
 * the address rows: whether an address EXISTS is what gates posting, and the viewer is
 * not entitled to read the counterparty's until collateral locks.
 */
export async function tradeStepPlan(
  supabase: CallerClient,
  userId: string,
  tradeId: string,
): Promise<StepPlanResult> {
  if (!tradeId) {
    return fail('NOT_FOUND', 'That trade could not be found.');
  }

  const { data: trade } = await supabase
    .from('trades')
    .select('*')
    .eq('id', tradeId)
    .maybeSingle();

  if (!trade) {
    return fail('NOT_FOUND', 'That trade could not be found.');
  }

  const isInitiator = trade.initiator_id === userId;
  const isCounterpart = trade.counterpart_id === userId;
  if (!isInitiator && !isCounterpart) {
    return fail('NOT_A_PARTICIPANT', 'You are not a party to that trade.');
  }

  const state: unknown = trade.state;
  if (!isTradeState(state)) {
    return fail(
      'STATUS_NOT_RECOGNISED',
      'This trade is in a state this app cannot describe yet.',
    );
  }

  const { data: holds } = await supabase
    .from('pre_auth_holds')
    .select('trader_id, status, created_at')
    .eq('trade_id', tradeId);

  const counterpartyName = await counterpartyNameFor(
    supabase,
    isInitiator ? trade.counterpart_id : trade.initiator_id,
  );

  const facts = {
    ...factsFromTrade(trade as TradeRow),
    ...deriveHoldLegs(holds ?? [], trade.initiator_id, trade.counterpart_id),
  };

  const steps = deriveTradeSteps({
    state,
    viewerRole: isInitiator ? 'INITIATOR' : 'COUNTERPART',
    facts,
    counterpartyName,
    addresses:
      trade.handover_method === 'DELIVERY'
        ? {
            mine: isInitiator
              ? trade.initiator_delivery_address_configured
              : trade.counterpart_delivery_address_configured,
            theirs: isInitiator
              ? trade.counterpart_delivery_address_configured
              : trade.initiator_delivery_address_configured,
          }
        : undefined,
  });

  return ok({
    contractId: trade.id,
    contractStatus: state,
    counterpartyName,
    steps: toWire(steps),
  });
}
