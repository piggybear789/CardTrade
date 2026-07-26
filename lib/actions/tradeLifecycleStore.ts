// lib/actions/tradeLifecycleStore.ts
//
// Server-only helper for the 2-Way Trade lifecycle *timestamp* writes (Req 6.1,
// 6.3, 6.5, 6.8) that back the `recordShipment` / `recordReceipt` /
// `recordAcceptance` server actions in `trades.ts`.
//
// Why this lives outside the orchestrator cores: end-user Trade writes are not
// granted by RLS (see the design note - participants get READ only), so the
// per-trader shipment/receipt/acceptance timestamp must be persisted through the
// trusted service-role admin client. Rather than editing the orchestrator cores
// that other parallel tasks depend on, this module adds a focused, guarded write
// plus the small mapping helpers the actions need. It carries the `server-only`
// dependency so it can never be pulled into client code.
//
// The write is guarded two ways for once-only + state safety (Req 6.8):
//   * `.is(<column>, null)`   - only stamps a trader's own leg if not already set
//   * `.eq('state', <state>)` - only stamps while the Trade is in the permitting
//                               state, so a concurrent transition cannot slip a
//                               late timestamp into the wrong state
// A write that matches no row (already recorded, or state moved on) returns
// `recorded: false` so the caller can reject with the correct error.

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Tables, TablesUpdate } from '@/lib/supabase/database.types';
import type { TradeFacts, TradeState, TradeViewerRole } from '@/domain/state-machine/types';

/** The full persisted Trade row shape. */
export type TradeRow = Tables<'trades'>;

/** The three per-trader lifecycle actions of Req 6. */
export type LifecycleAction = 'shipment' | 'receipt' | 'acceptance';

/**
 * Static description of a lifecycle action: the Trade_State in which it is
 * permitted, the aggregate `TradeFacts` group it feeds, and the per-role Trade
 * columns that hold each trader's timestamp.
 */
interface LifecycleSpec {
  /** The only state in which this action may be recorded (Req 6.1/6.3/6.5). */
  requiredState: TradeState;
  /** Which `TradeFacts` group this action populates. */
  factGroup: 'shipped' | 'received' | 'accepted';
  /** The timestamp columns keyed by viewer role. */
  columns: Record<TradeViewerRole, keyof TradeRow>;
}

/** The lifecycle action table - the single source of truth for column mapping. */
export const LIFECYCLE_SPECS: Record<LifecycleAction, LifecycleSpec> = {
  shipment: {
    requiredState: 'COLLATERAL_LOCKED',
    factGroup: 'shipped',
    columns: { INITIATOR: 'initiator_shipped_at', COUNTERPART: 'counterpart_shipped_at' },
  },
  receipt: {
    requiredState: 'IN_TRANSIT',
    factGroup: 'received',
    columns: { INITIATOR: 'initiator_received_at', COUNTERPART: 'counterpart_received_at' },
  },
  acceptance: {
    requiredState: 'INSPECTION',
    factGroup: 'accepted',
    columns: { INITIATOR: 'initiator_accepted_at', COUNTERPART: 'counterpart_accepted_at' },
  },
};

/**
 * Resolve which side of a Trade a user is on, or `null` if they are neither
 * Trader (Req 9.6/9.7). Callers use this both for authorization and to pick the
 * correct per-trader timestamp column / fact leg.
 */
export function roleForUser(trade: TradeRow, userId: string): TradeViewerRole | null {
  if (trade.initiator_id === userId) return 'INITIATOR';
  if (trade.counterpart_id === userId) return 'COUNTERPART';
  return null;
}

/** True iff the given trader has already recorded this lifecycle action. */
export function hasRecorded(
  trade: TradeRow,
  action: LifecycleAction,
  role: TradeViewerRole,
): boolean {
  const column = LIFECYCLE_SPECS[action].columns[role];
  return trade[column] != null;
}

/**
 * Build an aggregate {@link TradeFacts} snapshot from a Trade row. Shipment /
 * receipt / acceptance legs are derived from the presence of each per-trader
 * timestamp; hold activity is not tracked on the Trade row (it lives on
 * `pre_auth_holds`) and is not needed to derive the shipping/inspection
 * transitions, so it defaults to `false`.
 */
export function factsFromTrade(trade: TradeRow): TradeFacts {
  return {
    shipped: {
      initiator: trade.initiator_shipped_at != null,
      counterpart: trade.counterpart_shipped_at != null,
    },
    received: {
      initiator: trade.initiator_received_at != null,
      counterpart: trade.counterpart_received_at != null,
    },
    accepted: {
      initiator: trade.initiator_accepted_at != null,
      counterpart: trade.counterpart_accepted_at != null,
    },
    holdsActive: { initiator: false, counterpart: false },
  };
}

/** Outcome of a guarded lifecycle timestamp write. */
export type RecordTimestampResult =
  | { recorded: true; trade: TradeRow }
  | { recorded: false };

/**
 * Persist the caller's own lifecycle timestamp for a Trade through the
 * service-role admin client, guarded so it is applied at most once and only in
 * the permitting state (Req 6.1, 6.3, 6.5, 6.8).
 *
 * The update matches only when the trader's own column is still NULL and the
 * Trade is still in `requiredState`; if no row matches (already recorded, or the
 * state has advanced), it returns `{ recorded: false }` and mutates nothing. On
 * success the freshly updated row is returned so the caller can derive the
 * aggregate event without an extra read.
 */
export async function recordLifecycleTimestamp(params: {
  tradeId: string;
  action: LifecycleAction;
  role: TradeViewerRole;
  at?: Date;
}): Promise<RecordTimestampResult> {
  const spec = LIFECYCLE_SPECS[params.action];
  const column = spec.columns[params.role];
  const stampedAt = (params.at ?? new Date()).toISOString();

  // Build a typed single-column update; the computed key is one of the known
  // timestamp columns, so this is a well-formed `trades` update patch.
  const patch = { [column]: stampedAt } as TablesUpdate<'trades'>;

  const admin = createAdminClient();
  const { data } = await admin
    .from('trades')
    .update(patch)
    .eq('id', params.tradeId)
    .eq('state', spec.requiredState) // only stamp in the permitting state
    .is(column, null) // once-only: only stamp if not already recorded
    .select('*')
    .maybeSingle();

  if (!data) return { recorded: false };
  return { recorded: true, trade: data as TradeRow };
}
