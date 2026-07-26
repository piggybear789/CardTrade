'use server';

// lib/actions/account.ts
//
// Server-side reads that power the authenticated user's Account hub. Every query
// runs against the cookie-bound Supabase client so RLS scopes results to the
// caller automatically:
//   - items         → owner reads their own rows regardless of status
//   - cash_sales    → readable by the buyer or the seller
//   - trades        → readable by the two participants
//
// Money is integer AUD cents end-to-end; the UI formats via `formatAud`.
// Results follow the discriminated `AccountActionResult` shape used elsewhere.

import { createClient } from '@/lib/supabase/server';
import type { Tables, Enums } from '@/lib/supabase/database.types';

/** A persisted item row (owner-scoped in this module). */
export type ItemRow = Tables<'items'>;

/** Discriminated result returned by every account read. */
export type AccountActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: 'not-authenticated' | 'persistence-error';
      message?: string;
    };

/** A cash sale summarized for the Purchases / Sales lists. */
export interface CashSaleSummary {
  id: string;
  itemId: string;
  /** Item title snapshotted on the contract, so it survives the item selling. */
  itemTitle: string | null;
  /** First snapshotted image object path. */
  itemImagePath: string | null;
  amountCents: number;
  status: Enums<'cash_sale_status'>;
  createdAt: string;
}

/** A trade summarized for the Trades list. */
export interface TradeSummary {
  id: string;
  state: Enums<'trade_state'>;
  initiatorItemId: string;
  counterpartItemId: string;
  /** Titles of the goods the caller is giving, and receiving. */
  yourItemTitles: string[];
  theirItemTitles: string[];
  /** Cash on the trade, in integer AUD cents. */
  cashAmountCents: number;
  /** Whether the caller initiated the trade or is the counterpart. */
  role: 'initiator' | 'counterpart';
  createdAt: string;
}

/** Resolve the current authenticated user id, or `null`. */
async function getUserId(
  client: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  return user?.id ?? null;
}

/**
 * The caller's own items across all statuses (AVAILABLE / RESERVED / SOLD),
 * newest first. RLS returns owned rows regardless of status.
 */
export async function getMyListings(): Promise<AccountActionResult<ItemRow[]>> {
  const supabase = await createClient();

  const userId = await getUserId(supabase);
  if (!userId) return { ok: false, error: 'not-authenticated' };

  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }
  return { ok: true, data: (data ?? []) as ItemRow[] };
}

/**
 * Columns for a purchase/sale row. The item title and images come from the
 * CONTRACT SNAPSHOT rather than the live `items` row: item RLS only exposes
 * AVAILABLE items or your own, so a buyer cannot read the item once it is SOLD,
 * and a snapshot is also what the parties actually agreed on.
 */
const CASH_SALE_SUMMARY_COLUMNS =
  'id, item_id, amount_cents, status, created_at, item_title, item_image_paths';

/** Shape of the selected cash-sale summary row. */
interface CashSaleSummaryRow {
  id: string;
  item_id: string;
  amount_cents: number;
  status: Enums<'cash_sale_status'>;
  created_at: string;
  item_title: string | null;
  item_image_paths: string[] | null;
}

/** Map a snapshot row to the account list summary. */
function toCashSaleSummary(row: CashSaleSummaryRow): CashSaleSummary {
  return {
    id: row.id,
    itemId: row.item_id,
    itemTitle: row.item_title,
    itemImagePath: row.item_image_paths?.[0] ?? null,
    amountCents: row.amount_cents,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Cash sales where the caller is the buyer, newest first. */
export async function getMyPurchases(): Promise<
  AccountActionResult<CashSaleSummary[]>
> {
  const supabase = await createClient();

  const userId = await getUserId(supabase);
  if (!userId) return { ok: false, error: 'not-authenticated' };

  const { data, error } = await supabase
    .from('cash_sales')
    .select(CASH_SALE_SUMMARY_COLUMNS)
    .eq('buyer_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }

  return { ok: true, data: (data ?? []).map(toCashSaleSummary) };
}

/** Cash sales where the caller is the seller, newest first. */
export async function getMySales(): Promise<
  AccountActionResult<CashSaleSummary[]>
> {
  const supabase = await createClient();

  const userId = await getUserId(supabase);
  if (!userId) return { ok: false, error: 'not-authenticated' };

  const { data, error } = await supabase
    .from('cash_sales')
    .select(CASH_SALE_SUMMARY_COLUMNS)
    .eq('seller_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }

  return { ok: true, data: (data ?? []).map(toCashSaleSummary) };
}

/**
 * Trades where the caller is either participant (initiator or counterpart),
 * newest first. RLS restricts visibility to the two participants.
 */
export async function getMyTrades(): Promise<
  AccountActionResult<TradeSummary[]>
> {
  const supabase = await createClient();

  const userId = await getUserId(supabase);
  if (!userId) return { ok: false, error: 'not-authenticated' };

  const { data, error } = await supabase
    .from('trades')
    .select(
      'id, state, initiator_id, counterpart_id, initiator_item_id, counterpart_item_id, created_at, cash_amount_cents, trade_items(trader_id, item_id)',
    )
    .or(`initiator_id.eq.${userId},counterpart_id.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }

  const rows = data ?? [];

  // Resolve Item titles so the list reads as goods rather than id fragments, and
  // so a bundle can say how many items are on each side.
  const itemIds = Array.from(
    new Set(
      rows.flatMap((r) => [
        r.initiator_item_id as string,
        r.counterpart_item_id as string,
        ...((r.trade_items as { item_id: string }[] | null) ?? []).map((e) => e.item_id),
      ]),
    ),
  );
  const { data: itemRows } = itemIds.length
    ? await supabase.from('items').select('id, title').in('id', itemIds)
    : { data: [] as { id: string; title: string }[] };
  const titleById = new Map(
    (itemRows ?? []).map((row) => [row.id as string, (row.title as string) ?? 'Item']),
  );

  const summaries: TradeSummary[] = rows.map((r) => {
    const role = r.initiator_id === userId ? 'initiator' : 'counterpart';
    const bundle = ((r.trade_items as { trader_id: string; item_id: string }[] | null) ?? []);
    // Fall back to the primary Item columns for trades created before bundles.
    const sides = bundle.length
      ? bundle
      : [
          { trader_id: r.initiator_id as string, item_id: r.initiator_item_id as string },
          { trader_id: r.counterpart_id as string, item_id: r.counterpart_item_id as string },
        ];
    const titlesFor = (mine: boolean) =>
      sides
        .filter((entry) => (entry.trader_id === userId) === mine)
        .map((entry) => titleById.get(entry.item_id) ?? 'Item');

    return {
      id: r.id,
      state: r.state,
      initiatorItemId: r.initiator_item_id,
      counterpartItemId: r.counterpart_item_id,
      yourItemTitles: titlesFor(true),
      theirItemTitles: titlesFor(false),
      cashAmountCents: (r.cash_amount_cents as number) ?? 0,
      role,
      createdAt: r.created_at,
    };
  });

  return { ok: true, data: summaries };
}
