// scripts/e2e/cleanup-test-data.ts
//
// Finds and deletes every row an e2e spec created, identified ONLY by the
// marker each spec is required to stamp on its own data (see
// `tests/e2e/support/marker.ts`):
//
//   * a listing whose `items.title` starts with `[E2E] ` (marked()).
//   * a signup whose `profiles.display_name` starts with `[E2E] `, OR whose
//     `profiles.contact_email` starts with `e2e-` (markedEmail()).
//
// Run BEFORE and AFTER every e2e run: before, so a crashed previous run
// cannot leave stale rows a new spec collides with; after, so a normal run
// leaves the dev/staging project exactly as it found it.
//
//   npx tsx --env-file=.env.local scripts/e2e/cleanup-test-data.ts
//
// NOT `@supabase/supabase-js`. The JS client constructs a Realtime client on
// init, which requires a native WebSocket — Node 20 (what this repo runs
// locally) does not have one. `scripts/dump-demo-seed.ts` and
// `scripts/purge-orphaned-uploads.ts` hit exactly this and worked around it
// by talking to PostgREST directly over `fetch`; this script follows the same
// pattern. CardTrade's tables live in the `cardtrade` Postgres schema (not
// `public`), so every request carries `Accept-Profile` / `Content-Profile:
// cardtrade`.
//
// THE FK GRAPH (child before parent; migration each edge came from). Built by
// reading every `references cardtrade.*` in `supabase/migrations/` plus
// `lib/supabase/database.types.ts` for the handful of tables (`conversations`,
// `messages`, `offers`, `watchlist`, `notifications`, `reports`, `reviews`,
// `arbitration_assignments`, `arbitration_notes`) that were created directly
// against the remote database rather than through a checked-in migration —
// 0008_bilateral_cash_sales.sql even says so explicitly ("the remote schema
// already contains conversations"). `database.types.ts` is hand-authored to
// mirror the live schema, so it is the authoritative column list; the
// migrations are the authoritative source for each FK's ON DELETE behaviour.
//
//   messages.conversation_id / .sender_id     -> conversations / profiles  (no migration; live schema)
//   notifications.user_id                     -> profiles                 (no migration; live schema)
//   watchlist.item_id / .user_id               -> items / profiles         (no migration; live schema)
//   reviews.reviewer_id / .reviewee_id          -> profiles                 (no migration; live schema)
//   reviews.source_id (source_type=cash_sale/trade) -> cash_sales / trades  (polymorphic; no real FK — lib/actions/reviews.ts)
//   reports.reporter_id / .reviewed_by          -> profiles                 (no migration; live schema)
//   reports.target_id (target_type=item/user)  -> items / profiles         (polymorphic; no real FK — lib/actions/reports.ts)
//   arbitration_assignments.assignee_id/.assigned_by -> profiles            (0047_arbitration_workspace.sql, on delete cascade / plain)
//   arbitration_assignments.case_ref (case_kind=CASH_SALE/TRADE) -> cash_sales / trades (polymorphic uuid; no real FK — 0047)
//   charge_disputes.trade_id / .cash_sale_id / .profile_id -> trades / cash_sales / profiles (0036_charge_disputes.sql, all ON DELETE SET NULL)
//   webhook_logs.trade_id                      -> trades                   (0001_schema.sql, NO ON DELETE clause = NO ACTION — must delete first)
//   trade_state_transitions.trade_id           -> trades                   (0001_schema.sql, ON DELETE CASCADE)
//   pre_auth_holds.trade_id                    -> trades                   (0001_schema.sql, ON DELETE CASCADE)
//   trade_fees.trade_id                        -> trades                   (0056_trade_fees.sql, ON DELETE CASCADE)
//   trade_delivery_details.trade_id            -> trades                   (0057_trade_fulfilment_parity.sql, ON DELETE CASCADE)
//   trade_items.trade_id / .item_id            -> trades / items           (0015_trade_bundles.sql, trade_id ON DELETE CASCADE; item_id plain — this is
//                                                                            how an [E2E] item can be dragged into a trade the item-title/owner walk alone
//                                                                            would miss, since a trade's OWN initiator_item_id/counterpart_item_id columns
//                                                                            only name the primary pair, not every bundled item)
//   cash_sale_items.cash_sale_id               -> cash_sales               (0064_shopfront_listings_and_contract_line_items.sql, ON DELETE CASCADE)
//   cash_sale_events.cash_sale_id / .actor_id   -> cash_sales / profiles    (0008_bilateral_cash_sales.sql, cash_sale_id ON DELETE CASCADE)
//   cash_sale_delivery_details.cash_sale_id / .buyer_id -> cash_sales / profiles (0050_protect_cash_sale_delivery_details.sql, cash_sale_id ON DELETE CASCADE, is the PK)
//   conversations.item_id / .trade_id / .cash_sale_id / .participant_a / .participant_b
//                                               -> items / trades / cash_sales / profiles
//                                               (trade_id: 0016_trade_conversation.sql ON DELETE CASCADE;
//                                                cash_sale_id: 0019_dispute_conversation.sql ON DELETE CASCADE;
//                                                item_id/participants: no migration, live schema, assumed NO ACTION — delete first to be safe)
//
//   THE CYCLE, and the one edge in it that actually blocks. `conversations` and
//   `cash_sales` reference EACH OTHER:
//     conversations.cash_sale_id         -> cash_sales    ON DELETE CASCADE       (harmless)
//     cash_sales.conversation_id         -> conversations ON DELETE **NO ACTION**  <-- blocks
//     cash_sales.dispute_conversation_id -> conversations ON DELETE SET NULL       (harmless)
//     trades.conversation_id             -> conversations ON DELETE SET NULL       (harmless)
//   Deleting a conversation a cash_sale points at fails with 23503 ("still
//   referenced from table cash_sales") — and no delete ORDER fixes a cycle.
//   `nullifyConversationLinks` breaks it by clearing `cash_sales.conversation_id`
//   first; the column is nullable because a contract exists before its room does.
//   This edge was missing from this graph, and the omission only became visible
//   once a spec accepted an offer — the one flow that opens a contract room on a
//   MARKED item.
//   offers.item_id / .seller_id / .buyer_id / .offered_by / .parent_offer_id
//                                               -> items / profiles / profiles / profiles / offers (self)
//                                               (no migration; live schema — lib/actions/offers.ts)
//   trades.initiator_item_id / .counterpart_item_id -> items               (0001_schema.sql, plain — NO ACTION)
//   trades.initiator_id / .counterpart_id / .dispute_raised_by / .disputed_against /
//     .fraud_victim_id / .fraud_claimed_by / .fraud_claimed_against / .cancelled_by -> profiles
//                                               (0001/0046/0052 — all plain, all always one of the trade's own two
//                                                participants, so they are covered for free once a trade's own
//                                                initiator_id/counterpart_id membership pulls it into tradeIds)
//   cash_sales.item_id / .buyer_id / .seller_id -> items / profiles         (0001_schema.sql, plain — NO ACTION)
//   deal_invites.host_id / .claimed_by / .host_item_id / .cash_sale_id / .trade_id
//                                               -> profiles / items / cash_sales / trades
//                                               (0103_deal_invites.sql — delete BEFORE trades,
//                                                cash_sales and items; the invite is the door,
//                                                the contract rows are the rooms)
//
//   cash_sales.cancelled_by / .disputed_by / .dispute_resolved_by -> profiles
//                                               (0008_cash_sale_contract.sql / 0044_cash_sale_dispute_resolution.sql, plain —
//                                                UNLIKE the trade columns above, `dispute_resolved_by` is an OPERATOR
//                                                decision and can plausibly name a THIRD-PARTY staff profile that is
//                                                not the buyer or seller; nulled defensively below rather than assumed)
//   items.owner_id                             -> profiles                 (0001_schema.sql, ON DELETE CASCADE)
//   profiles.id                                -> auth.users               (0001_schema.sql, ON DELETE CASCADE)
//   profiles.fraud_banned_by / .fraud_ban_trade_id -> profiles / trades    (0059_confirmed_fraud_bans.sql, both ON DELETE SET NULL — no action needed)
//
// EXCLUDED, DELIBERATELY: cardtrade.arbitration_notes.
//
// 0047_arbitration_workspace.sql is explicit: "Notes are an audit trail:
// append-only. No update or delete policy, deliberately," and the migration
// backs that with `revoke update, delete on cardtrade.arbitration_notes from
// authenticated`. That is an application-level invariant, not just an RLS
// detail this script could route around with the service-role key — deleting
// a staff note here would be the same mistake the product schema was written
// to prevent. So this script never touches the table.
//
// The flip side: `author_id` is `not null references cardtrade.profiles(id)`
// with NO on-delete clause (plain NO ACTION), so a profile that authored a
// note cannot be deleted while the note exists — by design, the same way a
// human can't retroactively un-author an audit entry. In practice this should
// never fire: writing a note requires `is_support` or `is_admin`, both
// provider-controlled columns `authenticated` cannot set (revoked in the same
// migration), so a plain signUp() through `markedEmail()` can never reach
// staff status. If a spec ever grants staff status to a throwaway profile via
// the service-role key to test the arbitration workspace, use one of the
// FIXED seed staff accounts in `tests/e2e/support/users.ts`
// (GRACE_SUPPORT / FRANK_ADMIN) instead — those are never touched by this
// script because their emails and display names don't match the [E2E]
// marker. `deleteProfiles` below still tries every matched profile
// individually and warns (rather than crashing the whole run) if one is
// blocked this way, so the rest of cleanup still completes.

// An empty export makes this file an ES module rather than a global script,
// so its top-level names (`main` in particular) don't collide with the same
// name declared by other import-free scripts under `scripts/` — e.g.
// `purge-orphaned-uploads.ts` — when the whole project is type-checked in one
// program.
export {};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Run with: npx tsx --env-file=.env.local scripts/e2e/cleanup-test-data.ts`,
    );
  }
  return value;
}

function restUrl(table: string): string {
  return `${requireEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '')}/rest/v1/${table}`;
}

function authUrl(userId: string): string {
  return `${requireEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '')}/auth/v1/admin/users/${userId}`;
}

function restHeaders(): Record<string, string> {
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Accept-Profile': 'cardtrade',
    'Content-Profile': 'cardtrade',
    'Content-Type': 'application/json',
  };
}

// ---------------------------------------------------------------------------
// PostgREST filter-string helpers.
//
// Every multi-column match is expressed as an `or=(...)` list built from these
// small fragments, each of which returns `null` (rather than an empty
// `in.()`, which PostgREST does not accept) when its id list is empty — so a
// condition that would match nothing is dropped instead of breaking the
// request.
// ---------------------------------------------------------------------------

function inCond(column: string, ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  return `${column}.in.(${ids.join(',')})`;
}

/** `and(column.eq.value, inColumn.in.(ids))` — for a polymorphic (type, id) pair. */
function eqAndIn(column: string, value: string, inColumn: string, ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  return `and(${column}.eq.${value},${inColumn}.in.(${ids.join(',')}))`;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

// ---------------------------------------------------------------------------
// Generic PostgREST select / delete.
// ---------------------------------------------------------------------------

async function fetchIds(
  table: string,
  params: URLSearchParams,
  column = 'id',
): Promise<string[]> {
  params.set('select', column);
  const res = await fetch(`${restUrl(table)}?${params.toString()}`, { headers: restHeaders() });
  if (!res.ok) {
    throw new Error(`${table} select: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as Record<string, string>[];
  return rows.map((row) => row[column]).filter((value): value is string => typeof value === 'string');
}

/** DELETE matching rows and return how many were removed. */
async function deleteWhere(table: string, params: URLSearchParams): Promise<number> {
  const res = await fetch(`${restUrl(table)}?${params.toString()}`, {
    method: 'DELETE',
    headers: { ...restHeaders(), Prefer: 'return=representation' },
  });
  if (!res.ok) {
    throw new Error(`${table} delete: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as unknown[];
  return Array.isArray(rows) ? rows.length : 0;
}

async function deleteByIdsIn(table: string, column: string, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const params = new URLSearchParams();
  params.set(column, `in.(${ids.join(',')})`);
  return deleteWhere(table, params);
}

async function deleteByOr(table: string, conditions: (string | null)[]): Promise<number> {
  const present = conditions.filter(isPresent);
  if (present.length === 0) return 0;
  const params = new URLSearchParams();
  params.set('or', `(${present.join(',')})`);
  return deleteWhere(table, params);
}

/** Log a per-table result and return the count, so callers can sum a total. */
async function step(label: string, run: () => Promise<number>): Promise<number> {
  const count = await run();
  console.log(count > 0 ? `  ${label}: removed ${count}` : `  ${label}: already clean`);
  return count;
}

// ---------------------------------------------------------------------------
// Resolve the two marked root sets, then everything reachable from them.
// ---------------------------------------------------------------------------

/** `profiles` created by a marked signup: display_name OR contact_email marked. */
async function fetchMarkedProfileIds(): Promise<string[]> {
  const params = new URLSearchParams();
  params.set('or', '(display_name.ilike.[E2E]*,contact_email.ilike.e2e-*)');
  return fetchIds('profiles', params);
}

/** `items` whose title is marked, plus any item owned by a marked profile. */
async function fetchMarkedItemIds(profileIds: readonly string[]): Promise<string[]> {
  const conditions = ['title.ilike.[E2E]*', inCond('owner_id', profileIds)].filter(isPresent);
  const params = new URLSearchParams();
  params.set('or', `(${conditions.join(',')})`);
  return fetchIds('items', params);
}

/** Trades naming a marked item as the primary pair, or a marked profile as a trader. */
async function fetchTradeIdsByColumns(
  itemIds: readonly string[],
  profileIds: readonly string[],
): Promise<string[]> {
  const conditions = [
    inCond('initiator_item_id', itemIds),
    inCond('counterpart_item_id', itemIds),
    inCond('initiator_id', profileIds),
    inCond('counterpart_id', profileIds),
  ].filter(isPresent);
  if (conditions.length === 0) return [];
  const params = new URLSearchParams();
  params.set('or', `(${conditions.join(',')})`);
  return fetchIds('trades', params);
}

/**
 * Trades that bundle a marked item WITHOUT it being the primary
 * initiator/counterpart pair (0015_trade_bundles.sql `trade_items`). Without
 * this, deleting the item would fail against a dangling `trade_items.item_id`
 * FK on a trade the column-only walk above never found.
 */
async function fetchTradeIdsFromBundleItems(itemIds: readonly string[]): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set('item_id', `in.(${itemIds.join(',')})`);
  const tradeIds = await fetchIds('trade_items', params, 'trade_id');
  return Array.from(new Set(tradeIds));
}

async function fetchCashSaleIds(
  itemIds: readonly string[],
  profileIds: readonly string[],
): Promise<string[]> {
  const conditions = [
    inCond('item_id', itemIds),
    inCond('buyer_id', profileIds),
    inCond('seller_id', profileIds),
  ].filter(isPresent);
  if (conditions.length === 0) return [];
  const params = new URLSearchParams();
  params.set('or', `(${conditions.join(',')})`);
  return fetchIds('cash_sales', params);
}

async function fetchOfferIds(
  itemIds: readonly string[],
  profileIds: readonly string[],
): Promise<string[]> {
  const conditions = [
    inCond('item_id', itemIds),
    inCond('buyer_id', profileIds),
    inCond('seller_id', profileIds),
    inCond('offered_by', profileIds),
  ].filter(isPresent);
  if (conditions.length === 0) return [];
  const params = new URLSearchParams();
  params.set('or', `(${conditions.join(',')})`);
  return fetchIds('offers', params);
}

async function fetchConversationIds(
  itemIds: readonly string[],
  tradeIds: readonly string[],
  cashSaleIds: readonly string[],
  profileIds: readonly string[],
): Promise<string[]> {
  const conditions = [
    inCond('item_id', itemIds),
    inCond('trade_id', tradeIds),
    inCond('cash_sale_id', cashSaleIds),
    inCond('participant_a', profileIds),
    inCond('participant_b', profileIds),
  ].filter(isPresent);
  if (conditions.length === 0) return [];
  const params = new URLSearchParams();
  params.set('or', `(${conditions.join(',')})`);
  return fetchIds('conversations', params);
}

/**
 * Break the `conversations` <-> `cash_sales` cycle before conversations are deleted.
 *
 * `cash_sales.conversation_id` is ON DELETE **NO ACTION**, so a conversation that a
 * cash sale points at cannot be removed while that row exists — and the reverse
 * edge means there is no ordering of the two deletes that works. Clearing the
 * column first is the only way out. Safe because these cash sales are about to be
 * deleted anyway, and the column is nullable (a contract exists before its room).
 *
 * `dispute_conversation_id` and `trades.conversation_id` are ON DELETE SET NULL and
 * so need nothing.
 */
async function nullifyConversationLinks(cashSaleIds: readonly string[]): Promise<void> {
  if (cashSaleIds.length === 0) return;

  const params = new URLSearchParams();
  params.set('id', `in.(${cashSaleIds.join(',')})`);
  const res = await fetch(`${restUrl('cash_sales')}?${params.toString()}`, {
    method: 'PATCH',
    headers: restHeaders(),
    body: JSON.stringify({ conversation_id: null }),
  });
  if (!res.ok) {
    throw new Error(`cash_sales.conversation_id nullify: ${res.status} ${await res.text()}`);
  }
}

// ---------------------------------------------------------------------------
// PHASE 2 ROOT SET: marked CONTENT created between UNMARKED members.
//
// The walk above starts from marked profiles and marked items, which misses an
// entire class of test debris: a spec that signs in as two SEED members and has
// one message or make an offer to the other creates rows whose every foreign key
// points at a fixture row. Nothing about them matches `[E2E]`, so nothing above
// finds them — and they accumulate on every run. Left alone for a few dozen runs
// the seeded accounts end up with hundreds of conversations and an unread
// notification count in the thousands, which is both misleading when looking at
// the app by hand and slow to render in the specs that then read those pages.
//
// So the content itself is marked and matched directly:
//   * `messages.body`  starts with `[E2E] ` (specs send marked() bodies)
//   * `offers.message` starts with `[E2E] `
//   * `notifications.body` CONTAINS the marker, because a notification embeds the
//     message text it was raised for — that is what makes the derived row
//     findable without a marker column of its own.
//
// Conversations are then swept only when they are left EMPTY: a conversation with
// no messages is debris whichever run created it, and requiring emptiness means a
// thread that also carries real demo messages is never removed for containing one
// test message.
// ---------------------------------------------------------------------------

/** Messages whose body carries the marker. */
async function fetchMarkedMessageIds(): Promise<string[]> {
  const params = new URLSearchParams();
  params.set('body', 'ilike.[E2E]*');
  return fetchIds('messages', params);
}

/** Conversation ids referenced by marked messages, so emptiness can be re-tested after deletion. */
async function fetchConversationIdsOfMarkedMessages(): Promise<string[]> {
  const params = new URLSearchParams();
  params.set('body', 'ilike.[E2E]*');
  const ids = await fetchIds('messages', params, 'conversation_id');
  return Array.from(new Set(ids));
}

/** Offers whose accompanying note carries the marker. */
async function fetchMarkedOfferIds(): Promise<string[]> {
  const params = new URLSearchParams();
  params.set('message', 'ilike.[E2E]*');
  return fetchIds('offers', params);
}

/** Notifications whose body embeds the marker (they quote the message they announce). */
async function fetchMarkedNotificationIds(): Promise<string[]> {
  const params = new URLSearchParams();
  params.set('body', 'ilike.*[E2E]*');
  return fetchIds('notifications', params);
}

/**
 * Of the given conversations, those with no messages left.
 *
 * Called AFTER the marked messages are deleted, so a thread whose only content
 * was test messages is now empty and removable, while one that also holds demo
 * messages still has rows and is left alone.
 */
async function fetchEmptyConversationIds(
  candidateIds: readonly string[],
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set('conversation_id', `in.(${candidateIds.join(',')})`);
  const stillReferenced = new Set(await fetchIds('messages', params, 'conversation_id'));
  return candidateIds.filter((id) => !stillReferenced.has(id));
}

// ---------------------------------------------------------------------------
// Defensive: null out third-party STAFF references before removing profiles.
//
// Every "participant" FK (trader/buyer/seller/initiator) is already safe:
// deleting a profile that holds one of those roles also deletes the row it
// sits on (the trade/cash_sale itself), because that row is already in
// tradeIds/cashSaleIds by construction. The columns below are different —
// they can name an OPERATOR who is neither party, on a sale that is not
// otherwise related to this profile at all, so they are cleared explicitly
// rather than assumed away. See the "cash_sales.cancelled_by / .disputed_by /
// .dispute_resolved_by" line in the FK table above.
// ---------------------------------------------------------------------------

async function nullifyStaffReferences(profileIds: readonly string[]): Promise<void> {
  if (profileIds.length === 0) return;

  const targets: readonly [table: string, column: string][] = [
    ['cash_sales', 'cancelled_by'],
    ['cash_sales', 'disputed_by'],
    ['cash_sales', 'dispute_resolved_by'],
    ['cash_sale_events', 'actor_id'],
    ['trade_state_transitions', 'requested_by'],
  ];

  for (const [table, column] of targets) {
    const params = new URLSearchParams();
    params.set(column, `in.(${profileIds.join(',')})`);
    const res = await fetch(`${restUrl(table)}?${params.toString()}`, {
      method: 'PATCH',
      headers: restHeaders(),
      body: JSON.stringify({ [column]: null }),
    });
    if (!res.ok) {
      throw new Error(`${table}.${column} nullify: ${res.status} ${await res.text()}`);
    }
  }
}

// ---------------------------------------------------------------------------
// profiles / auth.users — deleted one id at a time.
//
// A single batched DELETE would let ONE row blocked by the arbitration_notes
// invariant (see the module comment) fail the whole statement and take every
// OTHER matched profile down with it. Looping isolates that failure to just
// the offending id.
// ---------------------------------------------------------------------------

async function deleteProfiles(profileIds: readonly string[]): Promise<number> {
  let removed = 0;
  for (const id of profileIds) {
    const params = new URLSearchParams();
    params.set('id', `eq.${id}`);
    try {
      removed += await deleteWhere('profiles', params);
    } catch (error) {
      console.warn(
        `  profiles: could not delete ${id} — ${error instanceof Error ? error.message : String(error)}`,
      );
      console.warn(
        '    (likely blocked by an arbitration_notes audit row authored by this profile — see the ' +
          'EXCLUDED, DELIBERATELY note near the top of this file)',
      );
    }
  }
  return removed;
}

async function deleteAuthUsers(profileIds: readonly string[]): Promise<number> {
  let removed = 0;
  for (const id of profileIds) {
    try {
      const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
      const res = await fetch(authUrl(id), {
        method: 'DELETE',
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      // 404 means a prior run already removed this account — fine, not an error.
      if (res.ok) {
        removed += 1;
        continue;
      }
      if (res.status === 404) continue;
      throw new Error(`${res.status} ${await res.text()}`);
    } catch (error) {
      console.warn(
        `  auth.users: could not delete ${id} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Resolving [E2E]-marked rows...');

  const profileIds = await fetchMarkedProfileIds();
  const itemIds = await fetchMarkedItemIds(profileIds);
  const tradeIds = Array.from(
    new Set([
      ...(await fetchTradeIdsByColumns(itemIds, profileIds)),
      ...(await fetchTradeIdsFromBundleItems(itemIds)),
    ]),
  );
  const cashSaleIds = await fetchCashSaleIds(itemIds, profileIds);
  const offerIds = await fetchOfferIds(itemIds, profileIds);
  const conversationIds = await fetchConversationIds(itemIds, tradeIds, cashSaleIds, profileIds);

  console.log(
    `Found ${profileIds.length} profile(s), ${itemIds.length} item(s), ${tradeIds.length} trade(s), ` +
      `${cashSaleIds.length} cash sale(s), ${offerIds.length} offer(s), ${conversationIds.length} conversation(s).`,
  );

  let total = 0;

  console.log('\nDeleting dependent rows (children before parents):');

  total += await step('messages', () =>
    deleteByOr('messages', [inCond('conversation_id', conversationIds), inCond('sender_id', profileIds)]),
  );
  total += await step('notifications', () => deleteByIdsIn('notifications', 'user_id', profileIds));
  total += await step('watchlist', () =>
    deleteByOr('watchlist', [inCond('item_id', itemIds), inCond('user_id', profileIds)]),
  );
  total += await step('reviews', () =>
    deleteByOr('reviews', [
      inCond('reviewer_id', profileIds),
      inCond('reviewee_id', profileIds),
      eqAndIn('source_type', 'cash_sale', 'source_id', cashSaleIds),
      eqAndIn('source_type', 'trade', 'source_id', tradeIds),
    ]),
  );
  total += await step('reports', () =>
    deleteByOr('reports', [
      inCond('reporter_id', profileIds),
      inCond('reviewed_by', profileIds),
      eqAndIn('target_type', 'item', 'target_id', itemIds),
      eqAndIn('target_type', 'user', 'target_id', profileIds),
    ]),
  );
  total += await step('arbitration_assignments', () =>
    deleteByOr('arbitration_assignments', [
      inCond('assignee_id', profileIds),
      inCond('assigned_by', profileIds),
      eqAndIn('case_kind', 'CASH_SALE', 'case_ref', cashSaleIds),
      eqAndIn('case_kind', 'TRADE', 'case_ref', tradeIds),
    ]),
  );
  // arbitration_notes: deliberately NOT deleted here. See the "EXCLUDED,
  // DELIBERATELY" note at the top of this file.
  total += await step('charge_disputes', () =>
    deleteByOr('charge_disputes', [
      inCond('profile_id', profileIds),
      inCond('trade_id', tradeIds),
      inCond('cash_sale_id', cashSaleIds),
    ]),
  );
  total += await step('webhook_logs', () => deleteByIdsIn('webhook_logs', 'trade_id', tradeIds));
  total += await step('trade_state_transitions', () =>
    deleteByIdsIn('trade_state_transitions', 'trade_id', tradeIds),
  );
  total += await step('pre_auth_holds', () => deleteByIdsIn('pre_auth_holds', 'trade_id', tradeIds));
  total += await step('trade_fees', () => deleteByIdsIn('trade_fees', 'trade_id', tradeIds));
  total += await step('trade_delivery_details', () =>
    deleteByIdsIn('trade_delivery_details', 'trade_id', tradeIds),
  );
  total += await step('trade_items', () => deleteByIdsIn('trade_items', 'trade_id', tradeIds));
  total += await step('cash_sale_items', () => deleteByIdsIn('cash_sale_items', 'cash_sale_id', cashSaleIds));
  total += await step('cash_sale_events', () => deleteByIdsIn('cash_sale_events', 'cash_sale_id', cashSaleIds));
  total += await step('cash_sale_delivery_details', () =>
    deleteByIdsIn('cash_sale_delivery_details', 'cash_sale_id', cashSaleIds),
  );
  total += await step('deal_invites', () =>
    deleteByOr('deal_invites', [
      inCond('host_id', profileIds),
      inCond('claimed_by', profileIds),
      inCond('host_item_id', itemIds),
      inCond('trade_id', tradeIds),
      inCond('cash_sale_id', cashSaleIds),
      'wanted_description.ilike.[E2E]*',
    ]),
  );
  // Breaks the conversations <-> cash_sales cycle. MUST precede the conversations
  // delete: see the CYCLE note in the FK graph above.
  await nullifyConversationLinks(cashSaleIds);
  total += await step('conversations', () => deleteByIdsIn('conversations', 'id', conversationIds));
  total += await step('offers', () => deleteByIdsIn('offers', 'id', offerIds));
  total += await step('trades', () => deleteByIdsIn('trades', 'id', tradeIds));
  total += await step('cash_sales', () => deleteByIdsIn('cash_sales', 'id', cashSaleIds));
  total += await step('items', () => deleteByIdsIn('items', 'id', itemIds));

  console.log('\nClearing third-party staff references before removing profiles:');
  await nullifyStaffReferences(profileIds);

  console.log('\nRemoving profiles and their auth accounts:');
  total += await step('profiles', () => deleteProfiles(profileIds));
  total += await step('auth.users', () => deleteAuthUsers(profileIds));

  // -------------------------------------------------------------------------
  // Phase 2: marked content between UNMARKED (seeded) members.
  //
  // Runs LAST, and after the profile sweep on purpose: anything belonging to a
  // marked profile is already gone by now, so whatever these queries still match
  // is by definition content sitting on fixture accounts — exactly the debris the
  // id walk cannot reach. See the phase-2 comment block above for why it exists.
  // -------------------------------------------------------------------------
  console.log('\nRemoving [E2E]-marked content on seeded members:');

  const conversationsToRetest = await fetchConversationIdsOfMarkedMessages();

  total += await step('notifications (marked body)', async () =>
    deleteByIdsIn('notifications', 'id', await fetchMarkedNotificationIds()),
  );
  total += await step('messages (marked body)', async () =>
    deleteByIdsIn('messages', 'id', await fetchMarkedMessageIds()),
  );
  // Emptiness is re-tested only now that those messages are gone.
  total += await step('conversations (left empty)', async () =>
    deleteByIdsIn('conversations', 'id', await fetchEmptyConversationIds(conversationsToRetest)),
  );
  total += await step('offers (marked note)', async () =>
    deleteByIdsIn('offers', 'id', await fetchMarkedOfferIds()),
  );

  console.log(`\nDone. ${total} row(s) removed.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
