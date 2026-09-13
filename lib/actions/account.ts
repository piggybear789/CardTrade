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

import {
  currentStep,
  deriveCashSaleSteps,
  deriveTradeSteps,
  isCashSaleStatus,
  isTradeState,
  type ContractStep,
  type ContractStepOwner,
} from '@/domain/contract';
import { deriveHoldLegs, type HoldRowLike } from '@/domain/state-machine/holdLegs';
import { factsFromTrade, type TradeRow } from '@/lib/actions/tradeLifecycleStore';
import { createClient } from '@/lib/supabase/server';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import type { Tables, Enums } from '@/lib/supabase/database.types';

/** A persisted item row (owner-scoped in this module). */
export type ItemRow = Tables<'items'>;

/** A cookie-bound Supabase client, as the reads in this module hold one. */
type CallerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The live step of a contract, resolved for one viewer.
 *
 * WHY A LIST CARRIES THIS AT ALL. Every contract list on the site showed a status
 * badge and nothing else, so a member with six open contracts could see that one was
 * `ESCROW_HELD` and still not know whether that meant "post it" or "wait". The badge
 * names the STATE; this names the MOVE.
 *
 * `label` is the step's own sentence, lifted verbatim from `domain/contract`. It is
 * NOT rephrased here and no second status-to-copy table exists: the alternative was a
 * lookup over thirteen statuses times two roles that would drift from the contract
 * room the first time either was touched.
 */
export interface ContractNextMove {
  /** `you`, `them`, `both` or `platform` — see {@link ContractStepOwner}. */
  owner: ContractStepOwner;
  /** What the step is, in the derivation's own words. */
  label: string;
}

/** Stand-in when a counterparty's profile cannot be read. Matches the API adapter. */
const UNKNOWN_COUNTERPARTY = 'the other party';

/**
 * Display names for a batch of counterparties, keyed by profile id.
 *
 * ONE QUERY FOR THE WHOLE LIST rather than one per row. `public_profiles` is the only
 * place a counterparty name may be read from — deliberately not `discoverable_profiles`,
 * which omits closed accounts: a contract does not stop having two sides because one of
 * them left, and a list that hid a closed counterparty would leave a live contract
 * describing itself as waiting on nobody.
 */
async function counterpartyNames(
  supabase: CallerClient,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();

  const { data } = await supabase
    .from('public_profiles')
    .select('id, display_name')
    .in('id', unique);

  return new Map(
    (data ?? []).map((row) => {
      const name = (row.display_name as string | null)?.trim();
      return [
        row.id as string,
        name && name.length > 0 ? name : UNKNOWN_COUNTERPARTY,
      ] as const;
    }),
  );
}

/**
 * The step a plan is waiting on, or null when there is nothing outstanding.
 *
 * Null covers three cases that all mean the same thing to a list: the contract is
 * finished, it is halted, or its status is one this build does not recognise.
 */
function nextMoveFrom(steps: ContractStep[]): ContractNextMove | null {
  const step = currentStep(steps);
  return step ? { owner: step.owner, label: step.label } : null;
}

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
  /** Which side of this contract the caller is on. */
  viewerRole: 'BUYER' | 'SELLER';
  /** The other party, as the step copy names them. */
  counterpartyName: string;
  /** What the contract is waiting on, or null once it is over. */
  nextMove: ContractNextMove | null;
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
  /** The other trader, as the step copy names them. */
  counterpartyName: string;
  /** What the trade is waiting on, or null once it is over. */
  nextMove: ContractNextMove | null;
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
 *
 * WIDER THAN WHAT A ROW DISPLAYS, DELIBERATELY. The second group is what
 * `deriveCashSaleSteps` reads, so a list row can say whose move the contract is
 * waiting on. They cost nothing — the same query, more columns — and the alternative
 * was a status-to-copy table beside the derivation the contract room already uses.
 */
const CASH_SALE_SUMMARY_COLUMNS = [
  'id',
  'item_id',
  'amount_cents',
  'status',
  'created_at',
  'item_title',
  'item_image_paths',
  // Identifies the counterparty, whose display name the step copy interpolates.
  'buyer_id',
  'seller_id',
  // The step facts. Column for column, `lib/api/contractStepPlan.ts`'s mapping —
  // which is itself `CashSaleView`'s.
  'fulfillment_method',
  'terms_version',
  'tracking_number',
  'buyer_handover_confirmed_at',
  'seller_handover_confirmed_at',
  'disputed_by',
  'return_tracking_number',
  'return_disputed_at',
].join(', ');

/** Shape of the selected cash-sale summary row. */
interface CashSaleSummaryRow {
  id: string;
  item_id: string;
  amount_cents: number;
  status: Enums<'cash_sale_status'>;
  created_at: string;
  item_title: string | null;
  item_image_paths: string[] | null;
  buyer_id: string;
  seller_id: string;
  fulfillment_method: string | null;
  terms_version: number;
  tracking_number: string | null;
  buyer_handover_confirmed_at: string | null;
  seller_handover_confirmed_at: string | null;
  disputed_by: string | null;
  return_tracking_number: string | null;
  return_disputed_at: string | null;
}

/** Map a snapshot row to the account list summary. */
function toCashSaleSummary(
  row: CashSaleSummaryRow,
  userId: string,
  viewerRole: 'BUYER' | 'SELLER',
  names: Map<string, string>,
): CashSaleSummary {
  const iAmBuyer = viewerRole === 'BUYER';
  const counterpartyName =
    names.get(iAmBuyer ? row.seller_id : row.buyer_id) ?? UNKNOWN_COUNTERPARTY;

  // `haltedAt` IS DELIBERATELY NOT SUPPLIED. Reading it means one `cash_sale_events`
  // query per contract, and all it refines is WHICH step a closed contract marks as
  // halted. A closed contract has no live step either way, so `currentStep` is null and
  // this surface shows no next move for one — the refinement would change nothing here.
  // The contract room, where the halt point IS the point, still reads it.
  //
  // The guard rather than a cast: a status this build has never seen (a migration
  // adding one) must produce no next move rather than a plan that looks derived and is
  // not. Same reasoning as `cashSaleStepPlan`, which refuses outright.
  const steps: ContractStep[] = isCashSaleStatus(row.status)
    ? deriveCashSaleSteps({
        status: row.status,
        viewerRole,
        counterpartyName,
        termsSet: row.fulfillment_method !== null,
        termsVersion: row.terms_version,
        isDelivery: row.fulfillment_method === 'DELIVERY',
        hasTracking: Boolean(row.tracking_number),
        myHandoverConfirmed: Boolean(
          iAmBuyer
            ? row.buyer_handover_confirmed_at
            : row.seller_handover_confirmed_at,
        ),
        theirHandoverConfirmed: Boolean(
          iAmBuyer
            ? row.seller_handover_confirmed_at
            : row.buyer_handover_confirmed_at,
        ),
        disputeRaisedByMe: row.disputed_by === userId,
        hasReturnTracking: Boolean(row.return_tracking_number),
        returnDisputed: Boolean(row.return_disputed_at),
      })
    : [];

  return {
    id: row.id,
    itemId: row.item_id,
    itemTitle: row.item_title,
    itemImagePath: row.item_image_paths?.[0] ?? null,
    amountCents: row.amount_cents,
    status: row.status,
    createdAt: row.created_at,
    viewerRole,
    counterpartyName,
    nextMove: nextMoveFrom(steps),
  };
}

/**
 * Cash sales where the caller is on `side`, newest first.
 *
 * ONE BODY FOR BOTH LISTS. Purchases and Sales differ by which column carries the
 * caller's id and which role the step plan is derived for, and nothing else — two
 * copies of this would be two places to widen the next time the derivation grows a
 * fact.
 */
async function loadCashSaleSummaries(
  side: 'BUYER' | 'SELLER',
): Promise<AccountActionResult<CashSaleSummary[]>> {
  const supabase = await createClient();

  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not-authenticated' };

  const { data, error } = await supabase
    .from('cash_sales')
    .select(CASH_SALE_SUMMARY_COLUMNS)
    .eq(side === 'BUYER' ? 'buyer_id' : 'seller_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }

  // `CASH_SALE_SUMMARY_COLUMNS` is a joined string, so supabase-js cannot infer the
  // projected shape from it — the same cast the sale page makes.
  const rows = (data ?? []) as unknown as CashSaleSummaryRow[];

  const names = await counterpartyNames(
    supabase,
    rows.map((row) => (side === 'BUYER' ? row.seller_id : row.buyer_id)),
  );

  return {
    ok: true,
    data: rows.map((row) => toCashSaleSummary(row, userId, side, names)),
  };
}

/** Cash sales where the caller is the buyer, newest first. */
export async function getMyPurchases(): Promise<
  AccountActionResult<CashSaleSummary[]>
> {
  return loadCashSaleSummaries('BUYER');
}

/** Cash sales where the caller is the seller, newest first. */
export async function getMySales(): Promise<
  AccountActionResult<CashSaleSummary[]>
> {
  return loadCashSaleSummaries('SELLER');
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

  // `*` RATHER THAN A COLUMN LIST. `factsFromTrade` maps the whole row onto the fact
  // interface the step derivation reads, so naming columns here would mean maintaining
  // a second, partial view of what that mapping needs — and a missing one is a silently
  // wrong plan, not a type error.
  const { data, error } = await supabase
    .from('trades')
    .select('*, trade_items(trader_id, item_id)')
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

  // THREE FOLLOW-UP READS IN ONE ROUND TRIP. Each needs only the ids above, so running
  // them in sequence would spend two round trips of pure latency on a page that has
  // already made one. The holds are read for the whole list at once rather than per
  // trade: `deriveHoldLegs` wants one trade's holds, but the query does not have to.
  const [itemsResult, holdsResult, names] = await Promise.all([
    itemIds.length
      ? supabase.from('items').select('id, title').in('id', itemIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    rows.length
      ? supabase
          .from('pre_auth_holds')
          .select('trade_id, trader_id, status, created_at')
          .in(
            'trade_id',
            rows.map((r) => r.id as string),
          )
      : Promise.resolve({
          data: [] as (HoldRowLike & { trade_id: string })[],
        }),
    counterpartyNames(
      supabase,
      rows.map((r) =>
        r.initiator_id === userId
          ? (r.counterpart_id as string)
          : (r.initiator_id as string),
      ),
    ),
  ]);

  const titleById = new Map(
    (itemsResult.data ?? []).map((row) => [
      row.id as string,
      (row.title as string) ?? 'Item',
    ]),
  );

  const holdsByTrade = new Map<string, HoldRowLike[]>();
  for (const hold of (holdsResult.data ?? []) as (HoldRowLike & {
    trade_id: string;
  })[]) {
    const existing = holdsByTrade.get(hold.trade_id);
    if (existing) existing.push(hold);
    else holdsByTrade.set(hold.trade_id, [hold]);
  }

  const summaries: TradeSummary[] = rows.map((r) => {
    const isInitiator = r.initiator_id === userId;
    const role = isInitiator ? 'initiator' : 'counterpart';
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

    const counterpartyName =
      names.get(isInitiator ? (r.counterpart_id as string) : (r.initiator_id as string)) ??
      UNKNOWN_COUNTERPARTY;

    // The mapping `tradeStepPlan` performs, verbatim: the row's own facts with the two
    // hold-derived legs overlaid, because `factsFromTrade` defaults those to false and
    // the release step depends on them. Addresses come from the row's
    // `*_delivery_address_configured` flags rather than the address rows — whether one
    // EXISTS is what gates posting, and a trader may not read the other's until
    // collateral locks.
    const state: unknown = r.state;
    const steps: ContractStep[] = isTradeState(state)
      ? deriveTradeSteps({
          state,
          viewerRole: isInitiator ? 'INITIATOR' : 'COUNTERPART',
          facts: {
            ...factsFromTrade(r as unknown as TradeRow),
            ...deriveHoldLegs(
              holdsByTrade.get(r.id as string) ?? [],
              r.initiator_id as string,
              r.counterpart_id as string,
            ),
          },
          counterpartyName,
          addresses:
            r.handover_method === 'DELIVERY'
              ? {
                  mine: isInitiator
                    ? r.initiator_delivery_address_configured
                    : r.counterpart_delivery_address_configured,
                  theirs: isInitiator
                    ? r.counterpart_delivery_address_configured
                    : r.initiator_delivery_address_configured,
                }
              : undefined,
        })
      : [];

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
      counterpartyName,
      nextMove: nextMoveFrom(steps),
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
