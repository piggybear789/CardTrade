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
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
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

/**
 * Resolve the current authenticated user id, or `null`.
 *
 * Reads through the request-cached lookup rather than `client.auth.getUser()`.
 * `getUser` revalidates the JWT against the auth server on every call, and the
 * account pages reach this helper once per section on top of the shell's own
 * read — previously a network round trip each.
 */
async function getUserId(): Promise<string | null> {
  const user = await getCachedAuthUser();
  return user?.id ?? null;
}

/**
 * The caller's own items across all statuses (AVAILABLE / RESERVED / SOLD),
 * newest first. RLS returns owned rows regardless of status.
 */
export async function getMyListings(): Promise<AccountActionResult<ItemRow[]>> {
  const supabase = await createClient();

  const userId = await getUserId();
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

  const userId = await getUserId();
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

  const userId = await getUserId();
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

  const userId = await getUserId();
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
// ---------------------------------------------------------------------------
// Account closure — the web entry point (Req 7.1)
// ---------------------------------------------------------------------------
//
// One capability, two entry points. `closeAccount` in
// `domain/orchestrator/accountClosureOrchestrator.ts` is the Account_Closure_Service;
// this action is the WEB door onto it and `app/api/mobile/account/close` is the mobile
// one. Nothing below re-derives the Money_In_Flight rule, re-checks eligibility, or
// writes anything itself — that would be the second copy Req 7.1 exists to prevent.
//
// A NOTE ON WHERE CONSTANTS GO. A `'use server'` module may only export async
// functions, so anything shareable this flow needs — a limit, a label, a code — belongs
// in `lib/marketplace-constants.ts` (or `lib/actions/result.ts` for types), never as a
// `export const` here.

import { revalidatePath } from 'next/cache';

import { signOut } from '@/lib/actions/auth';
import { createDefaultAccountClosureOrchestrator } from '@/domain/orchestrator/supabaseAccountClosureRepository';
import type { CloseAccountResult } from '@/domain/orchestrator/accountClosureOrchestrator';

/**
 * Close the signed-in member's own account (Req 7.1, 7.2, 7.3, 7.7).
 *
 * TAKES NO PARAMETERS, DELIBERATELY. Every export of a `'use server'` module is an
 * endpoint that anyone who learns its id can POST to, so a `profileId` argument would
 * be an attacker-supplied target reaching a service-role-backed write. The caller
 * identity comes from the session and is passed as BOTH `callerProfileId` and
 * `targetProfileId`, which makes the orchestrator's own-account guard (Req 7.7) hold
 * trivially rather than by trusting this action to have checked something.
 *
 * The closure instant is supplied here (`new Date()`) because the orchestrator takes
 * it as a required parameter and reads no clock of its own.
 *
 * RETURNED VERBATIM, NO TRANSLATION. `CloseAccountResult` is structurally identical to
 * `ActionResult<{ closedAt: string }, CloseAccountError>` from `lib/actions/result.ts`
 * — `{ ok: true; data }` / `{ ok: false; error; message }` — with one addition: the
 * failure variant may carry `blockers`, the Money_In_Flight categories Req 7.3 requires
 * the member be told. Narrowing this to `ActionResult` would drop them, so the
 * orchestrator's type is passed through unchanged. Nothing throws for an expected
 * failure.
 *
 * ON SUCCESS THE MEMBER IS SIGNED OUT (Req 7.2). The orchestrator has already revoked
 * their sessions server-side, but on the web the session also lives in a cookie this
 * request owns, so `signOut()` from `lib/actions/auth.ts` clears it rather than any
 * hand-rolled cookie deletion. A failure to clear the cookie is not reported as a
 * closure failure: the account IS closed, the sessions ARE revoked, and the stale
 * cookie stops working at its next refresh — telling the member closure failed would
 * be the false statement Req 7.8 forbids.
 */
export async function closeMyAccount(): Promise<CloseAccountResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // The same code and shape the orchestrator's own missing-caller branch returns, so
    // the UI has one case to render whichever layer refused.
    return {
      ok: false,
      error: 'NOT_ACCOUNT_OWNER',
      message: 'Sign in to close your account.',
    };
  }

  const orchestrator = createDefaultAccountClosureOrchestrator();
  const result = await orchestrator.closeAccount({
    callerProfileId: user.id,
    targetProfileId: user.id,
    at: new Date(),
  });

  if (!result.ok) {
    return result;
  }

  // What closure invalidates: the member's own account surfaces, and every public read
  // path that rendered their display name or avatar. Migration 0111 has
  // `public_profiles` substitute the anonymous label from `closed_at` alone, so these
  // paths are stale rather than wrong — but a cached page still showing the real name
  // is exactly what Req 7.5 asks be removed from every public read path.
  revalidatePath('/profile');
  revalidatePath(`/sellers/${user.id}`);
  // The catalog cards and listing detail pages both disclose the seller. `[id]` is
  // revalidated as a route rather than per id, because closure does not know which
  // listings the member fronted and their listings survive closure.
  revalidatePath('/');
  revalidatePath('/listings/[id]', 'page');

  // Req 7.2: clear this request's session cookie. Best-effort, for the reason in the
  // doc comment above.
  await signOut();

  return result;
}
