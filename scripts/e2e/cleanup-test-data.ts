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
// pattern. The suite's tables live in the `cardtrade_dev` sandbox schema (not
// `public`), so every request carries `Accept-Profile` / `Content-Profile:
// cardtrade_dev`. The script refuses to start on any other schema.
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
//   conversations.item_id / .trade_id / .participant_a / .participant_b
//                                               -> items / trades / profiles
//                                               (trade_id: 0016_trade_conversation.sql ON DELETE CASCADE;
//                                                item_id/participants: no migration, live schema, assumed NO ACTION — delete first to be safe)
//                                               conversations.cash_sale_id (0019) was dropped in 0115.
//
//   THE ONE EDGE THAT BLOCKS. `cash_sales` points at `conversations`:
//     cash_sales.conversation_id         -> conversations ON DELETE **NO ACTION**  <-- blocks
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

// The import also makes this file an ES module rather than a global script, so its
// top-level names (`main` in particular) don't collide with the same name declared
// by import-free scripts under `scripts/` when the project is type-checked as one.
//
// SHARED_RESOURCES (Req 2.4–2.8). After the rows, the same pass cleans what the sandbox
// shares with production, each by exact identity and never by a broader filter:
//
//   * auth.users — a marked `e2e-…@example.com` account missing `app_metadata.sandbox`
//     is flagged first (a sign-up the suite drove through the real form), logged, and
//     then deleted only through `isDeletableSandboxUser`.
//   * Storage — the exact paths in every `audit-artifacts/.uploads/<runId>.jsonl`, the
//     paths named by marked rows, and the `<profile id>/` folders of deletable sandbox
//     personas in the per-member buckets. Never a bucket-wide listing. A path a
//     surviving row still names is kept (see `tests/e2e/audit/core/sharedCleanup.ts`).
//   * Stripe — test keys only (`testStripe`). Each test platform is searched with
//     `runSearchQuery(runId)` for the current run and recent runs recorded on disk.
//     PaymentIntents and unfinished Identity sessions are cancelled, Customers and
//     connected accounts deleted, `cardtrade_e2e_fixture` objects kept, and anything
//     Stripe will not remove is written to the run manifest's `leftInStripe`.
//
// Every item cleanup cannot delete is logged. Nothing is retried with a wider filter.
//
//   --dry-run   resolve and log everything, write nothing (no row, auth, Storage,
//               Stripe, manifest or ledger change)

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { assertSandboxSchema, isDeletableSandboxUser, maskEmail } from '../../tests/e2e/audit/core/preflight';
import {
  ARTIFACT_ROOT,
  RUNS_DIR,
  UPLOADS_DIR,
  artifactPath,
  isRunId,
  type StorageObjectRef,
} from '../../tests/e2e/audit/core/artifactPaths';
import {
  decideStripeObject,
  mergeLeftInStripe,
  objectKey,
  ownerOfPath,
  parseUploadLedger,
  planStorageDeletion,
  runStartedAt,
  runsToHeal,
  type LeftInStripe,
  type StorageCandidate,
  type StripeObjectType,
} from '../../tests/e2e/audit/core/sharedCleanup';
import type { RunManifest } from '../../tests/e2e/audit/core/aggregate';
import {
  E2E_RUN_METADATA_KEY,
  runSearchQuery,
  StripeKeyRefusedError,
  TEST_PLATFORMS,
  testStripe,
  type TestPlatform,
} from '../../tests/e2e/audit/backend/stripe';

// THE SANDBOX ONLY (Req 2.8). Checked at module load, before any request is built:
// every read and delete below carries this schema in its profile headers, and the
// only value it can hold is `cardtrade_dev`. There is no default and no override.
const RAW_SCHEMA = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA?.trim();
assertSandboxSchema(RAW_SCHEMA);
const SCHEMA = RAW_SCHEMA;

/** `--dry-run`: read and report only. Every write below checks this first. */
const DRY_RUN = process.argv.includes('--dry-run');

/** The repository root, where `audit-artifacts/` lives. */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

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
    'Accept-Profile': SCHEMA,
    'Content-Profile': SCHEMA,
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
  if (DRY_RUN) return countWhere(table, params);
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

/** `--dry-run`'s stand-in for a DELETE: how many rows the same filter matches. */
async function countWhere(table: string, params: URLSearchParams): Promise<number> {
  const res = await fetch(`${restUrl(table)}?${params.toString()}`, {
    method: 'HEAD',
    headers: { ...restHeaders(), Prefer: 'count=exact' },
  });
  if (!res.ok) throw new Error(`${table} count: ${res.status}`);
  const total = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1];
  return total ? Number(total) : 0;
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
  const verb = DRY_RUN ? 'would remove' : 'removed';
  console.log(count > 0 ? `  ${label}: ${verb} ${count}` : `  ${label}: already clean`);
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
  _cashSaleIds: readonly string[],
  profileIds: readonly string[],
): Promise<string[]> {
  // NO `cash_sale_id` FILTER. The column was dropped in 0115 — as the schema notes at
  // the top of this file already record — but the condition stayed, so PostgREST
  // answered `42703 column conversations.cash_sale_id does not exist` and cleanup
  // aborted.
  //
  // IT FAILED ONLY SOMETIMES, which is why it survived. `inCond` returns undefined for
  // an empty id list and the conditions are filtered, so the bad column reached the
  // query ONLY on a run that had cash sales to clean — i.e. after a contract spec, not
  // after a catalog one. And because `globalSetup` runs this script, the whole suite
  // then failed to start with an error naming a table no spec had touched.
  //
  // A cash sale's conversation is still reached: it is found through `item_id` (the
  // listing the contract is against) and through both participants.
  const conditions = [
    inCond('item_id', itemIds),
    inCond('trade_id', tradeIds),
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
 * `trades.conversation_id` is ON DELETE SET NULL and so needs nothing.
 */
async function nullifyConversationLinks(cashSaleIds: readonly string[]): Promise<void> {
  if (cashSaleIds.length === 0 || DRY_RUN) return;

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
  if (profileIds.length === 0 || DRY_RUN) return;

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

/** The fields of an Admin API user this script reads. */
interface AuthUser {
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
}

/** Auth users read so far, by id; `null` is a 404. Reads only, so safe to cache. */
const authUsers = new Map<string, AuthUser | null>();

/** Ids a `--dry-run` would have flagged, so the rest of the dry run reads them flagged. */
const wouldFlag = new Set<string>();

function authHeaders(): Record<string, string> {
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/** Reads one auth user through the Admin API, or null when there is none. Throws on error. */
async function readAuthUser(id: string): Promise<AuthUser | null> {
  if (authUsers.has(id)) return authUsers.get(id) ?? null;
  const res = await fetch(authUrl(id), { headers: authHeaders() });
  if (res.status === 404) {
    authUsers.set(id, null);
    return null;
  }
  if (!res.ok) throw new Error(`auth lookup ${res.status}`);
  const user = (await res.json()) as AuthUser;
  authUsers.set(id, user);
  return user;
}

/** True when the user is flagged `app_metadata.sandbox = true` (seeds and personas). */
function isSandboxFlagged(id: string, user: AuthUser | null): boolean {
  return user?.app_metadata?.sandbox === true || wouldFlag.has(id);
}

/**
 * Flags every marked account that is a reserved test address (`e2e-…@example.com`)
 * but lacks `app_metadata.sandbox = true`, e.g. one the suite signed up through the
 * real form (design, Cleanup). Logged with the email masked. Only an address
 * `isDeletableSandboxUser` would accept once flagged is ever flagged, so a real member
 * who happens to carry a marked display name is never touched.
 *
 * Returns the ids that are deletable sandbox personas after this pass.
 */
async function flagUnflaggedSandboxAccounts(profileIds: readonly string[]): Promise<Set<string>> {
  const deletable = new Set<string>();
  for (const id of profileIds) {
    try {
      const user = await readAuthUser(id);
      if (user === null) continue;
      if (isDeletableSandboxUser(user)) {
        deletable.add(id);
        continue;
      }
      const flagged = { ...user, app_metadata: { ...(user.app_metadata ?? {}), sandbox: true } };
      if (!isDeletableSandboxUser(flagged)) continue; // not a reserved test address
      const masked = maskEmail(user.email ?? '');
      if (DRY_RUN) {
        console.warn(`  auth.users: ${id} (${masked}) lacks the sandbox flag — would flag it`);
        wouldFlag.add(id);
        deletable.add(id);
        continue;
      }
      console.warn(`  auth.users: ${id} (${masked}) lacked the sandbox flag — flagging it`);
      const res = await fetch(authUrl(id), {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_metadata: flagged.app_metadata }),
      });
      if (!res.ok) throw new Error(`flag ${res.status}`);
      authUsers.set(id, flagged);
      deletable.add(id);
    } catch (error) {
      console.warn(
        `  auth.users: could not check or flag ${id} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return deletable;
}

/**
 * Deletes the auth account behind each matched profile, but ONLY when
 * `isDeletableSandboxUser` says so: an `e2e-…@example.com` email AND
 * `app_metadata.sandbox === true` (Req 2.1, 2.8). `auth.users` is shared with
 * production (it is one Supabase project), so a profile marked only by display
 * name is never enough to delete the account behind it. The user is read back
 * first and a non-matching one is skipped with a warning naming its id only.
 */
async function deleteAuthUsers(profileIds: readonly string[]): Promise<number> {
  let removed = 0;
  for (const id of profileIds) {
    try {
      const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
      const headers = { apikey: key, Authorization: `Bearer ${key}` };
      const lookup = await fetch(authUrl(id), { headers });
      // 404 means a prior run already removed this account — fine, not an error.
      if (lookup.status === 404) continue;
      if (!lookup.ok) throw new Error(`lookup ${lookup.status} ${await lookup.text()}`);
      const user = (await lookup.json()) as AuthUser;
      // In a dry run the flag `flagUnflaggedSandboxAccounts` would have set is absent.
      const effective = DRY_RUN && wouldFlag.has(id)
        ? { ...user, app_metadata: { ...(user.app_metadata ?? {}), sandbox: true } }
        : user;
      if (!isDeletableSandboxUser(effective)) {
        console.warn(`  auth.users: skipped ${id} — not a marked sandbox account`);
        continue;
      }
      if (DRY_RUN) {
        removed += 1;
        continue;
      }
      const res = await fetch(authUrl(id), {
        method: 'DELETE',
        headers,
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
// Storage (Req 2.4, 2.5, 2.6). Shared with production: exact paths only.
// ---------------------------------------------------------------------------

/** Buckets whose objects live under `<profile id>/` (`lib/storage/*`). */
const PER_MEMBER_BUCKETS = [
  'item-images',
  'profile-images',
  'message-attachments',
  'dispute-evidence',
  'trusted-seller-photos',
  'scam-report-evidence',
  'reference-proof',
  'handle-claim-evidence',
] as const;

/** Every sandbox column that names an object, per bucket. A match keeps the object. */
const REFERENCING_COLUMNS: Record<string, readonly { table: string; column: string; array: boolean }[]> = {
  'item-images': [
    { table: 'items', column: 'image_paths', array: true },
    { table: 'cash_sales', column: 'item_image_paths', array: true },
    { table: 'cash_sale_items', column: 'image_path', array: false },
    { table: 'notifications', column: 'image_path', array: false },
  ],
  'profile-images': [{ table: 'profiles', column: 'avatar_path', array: false }],
  'message-attachments': [{ table: 'messages', column: 'attachment_path', array: false }],
  'dispute-evidence': [{ table: 'dispute_evidence', column: 'media_paths', array: true }],
  'trusted-seller-photos': [{ table: 'trusted_seller_reviews', column: 'photo_paths', array: true }],
  'scam-report-evidence': [
    { table: 'scam_reports', column: 'evidence_paths', array: true },
    { table: 'scam_report_matches', column: 'member_response_paths', array: true },
  ],
  'reference-proof': [{ table: 'member_references', column: 'proof_paths', array: true }],
  'handle-claim-evidence': [{ table: 'handle_claim_requests', column: 'screenshot_paths', array: true }],
  'proof-of-card': [{ table: 'proof_of_card_challenges', column: 'proof_photo_path', array: false }],
};

/** Characters that would need escaping inside a PostgREST list; such a path is kept. */
const UNSAFE_IN_FILTER = /["',\\(){}]/;

function storageBase(): string {
  return `${requireEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '')}/storage/v1`;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** Every non-empty value of `column` (text or text[]) on rows matching `conditions`. */
async function fetchColumnValues(
  table: string,
  column: string,
  conditions: (string | null)[],
): Promise<string[]> {
  const present = conditions.filter(isPresent);
  if (present.length === 0) return [];
  const params = new URLSearchParams();
  params.set('select', column);
  params.set('or', `(${present.join(',')})`);
  const res = await fetch(`${restUrl(table)}?${params.toString()}`, { headers: restHeaders() });
  if (!res.ok) throw new Error(`${table}.${column} select: ${res.status}`);
  const rows = (await res.json()) as Record<string, unknown>[];
  return rows.flatMap((row) => {
    const value = row[column];
    if (typeof value === 'string' && value !== '') return [value];
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v !== '');
    return [];
  });
}

/**
 * Paths named by the marked rows this run is about to delete. Read BEFORE the rows go.
 * A failed read is logged and skipped: the per-persona folder sweep and the ledger still
 * cover most of it, and guessing instead would widen the filter.
 */
async function collectRowPaths(ids: {
  profileIds: readonly string[];
  itemIds: readonly string[];
  conversationIds: readonly string[];
}): Promise<StorageCandidate[]> {
  const sources: { bucket: string; table: string; column: string; conditions: (string | null)[] }[] = [
    { bucket: 'item-images', table: 'items', column: 'image_paths', conditions: [inCond('id', ids.itemIds)] },
    {
      bucket: 'message-attachments',
      table: 'messages',
      column: 'attachment_path',
      conditions: [
        inCond('conversation_id', ids.conversationIds),
        inCond('sender_id', ids.profileIds),
        'body.ilike.[E2E]*',
      ],
    },
    { bucket: 'profile-images', table: 'profiles', column: 'avatar_path', conditions: [inCond('id', ids.profileIds)] },
    {
      bucket: 'dispute-evidence',
      table: 'dispute_evidence',
      column: 'media_paths',
      conditions: [inCond('author_id', ids.profileIds)],
    },
    {
      bucket: 'trusted-seller-photos',
      table: 'trusted_seller_reviews',
      column: 'photo_paths',
      conditions: [inCond('profile_id', ids.profileIds)],
    },
    {
      bucket: 'scam-report-evidence',
      table: 'scam_reports',
      column: 'evidence_paths',
      conditions: [inCond('reporter_id', ids.profileIds)],
    },
    {
      bucket: 'reference-proof',
      table: 'member_references',
      column: 'proof_paths',
      conditions: [inCond('voucher_id', ids.profileIds)],
    },
    {
      bucket: 'handle-claim-evidence',
      table: 'handle_claim_requests',
      column: 'screenshot_paths',
      conditions: [inCond('claimant_id', ids.profileIds)],
    },
  ];

  const candidates: StorageCandidate[] = [];
  for (const source of sources) {
    try {
      for (const value of await fetchColumnValues(source.table, source.column, source.conditions)) {
        candidates.push({ bucket: source.bucket, path: value, source: 'row' });
      }
    } catch (error) {
      console.warn(
        `  storage: could not read ${source.table}.${source.column} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return candidates;
}

/** Owners (first path segment) of row-named paths that are sandbox-flagged auth users. */
async function sandboxOwnersOf(candidates: readonly StorageCandidate[], known: ReadonlySet<string>): Promise<Set<string>> {
  const owners = new Set<string>(known);
  const toCheck = new Set<string>();
  for (const candidate of candidates) {
    const owner = ownerOfPath(candidate.path);
    if (owner && !owners.has(owner)) toCheck.add(owner);
  }
  for (const id of toCheck) {
    try {
      if (isSandboxFlagged(id, await readAuthUser(id))) owners.add(id);
    } catch (error) {
      // Unknown means not sandbox: the object is kept and logged by the planner.
      console.warn(`  storage: could not check owner ${id} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return owners;
}

/** One level of a bucket folder: object names and sub-folder names. */
async function listFolder(bucket: string, prefix: string): Promise<{ files: string[]; folders: string[] }> {
  const files: string[] = [];
  const folders: string[] = [];
  const limit = 1000;
  for (let offset = 0; offset < 20_000; offset += limit) {
    const res = await fetch(`${storageBase()}/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`list ${bucket}/${prefix}: ${res.status}`);
    const entries = (await res.json()) as { name?: string; id?: string | null }[];
    for (const entry of entries) {
      if (typeof entry.name !== 'string' || entry.name === '' || entry.name.includes('/')) continue;
      if (entry.id === null || entry.id === undefined) folders.push(entry.name);
      else files.push(entry.name);
    }
    if (entries.length < limit) break;
  }
  return { files, folders };
}

/**
 * Every object under `<profileId>/` in the per-member buckets, for a deletable sandbox
 * persona only. Lists inside that folder (and its sub-folders, a few levels deep), never
 * the bucket.
 */
async function sweepPersonaFolders(personaIds: ReadonlySet<string>): Promise<StorageCandidate[]> {
  const candidates: StorageCandidate[] = [];
  for (const id of personaIds) {
    if (ownerOfPath(`${id}/x`) !== id.toLowerCase()) continue; // not a uuid: no folder
    for (const bucket of PER_MEMBER_BUCKETS) {
      const queue: { prefix: string; depth: number }[] = [{ prefix: `${id}/`, depth: 0 }];
      try {
        while (queue.length > 0) {
          const { prefix, depth } = queue.shift()!;
          const { files, folders } = await listFolder(bucket, prefix);
          for (const file of files) candidates.push({ bucket, path: `${prefix}${file}`, source: 'prefix' });
          if (depth < 3) for (const folder of folders) queue.push({ prefix: `${prefix}${folder}/`, depth: depth + 1 });
        }
      } catch (error) {
        console.warn(`  storage: could not list ${bucket}/${id}/ — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return candidates;
}

/**
 * `bucket/path` keys a SURVIVING sandbox row still names. Run after the rows are
 * deleted. A failed query keeps every path it covered (fails closed).
 */
async function stillReferencedKeys(candidates: readonly StorageCandidate[]): Promise<Set<string>> {
  const referenced = new Set<string>();
  const byBucket = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (UNSAFE_IN_FILTER.test(candidate.path)) {
      referenced.add(objectKey(candidate));
      continue;
    }
    const set = byBucket.get(candidate.bucket) ?? new Set<string>();
    set.add(candidate.path);
    byBucket.set(candidate.bucket, set);
  }

  for (const [bucket, paths] of byBucket) {
    for (const { table, column, array } of REFERENCING_COLUMNS[bucket] ?? []) {
      for (const batch of chunk([...paths], 40)) {
        const quoted = batch.map((p) => `"${p}"`).join(',');
        const params = new URLSearchParams();
        params.set('select', column);
        params.set(column, array ? `ov.{${quoted}}` : `in.(${quoted})`);
        try {
          const res = await fetch(`${restUrl(table)}?${params.toString()}`, { headers: restHeaders() });
          if (!res.ok) throw new Error(`${res.status}`);
          const rows = (await res.json()) as Record<string, unknown>[];
          const named = new Set(
            rows.flatMap((row) => {
              const value = row[column];
              return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
            }),
          );
          for (const p of batch) if (named.has(p)) referenced.add(`${bucket}/${p}`);
        } catch (error) {
          console.warn(
            `  storage: could not check ${table}.${column} for ${batch.length} path(s) — keeping them (${error instanceof Error ? error.message : String(error)})`,
          );
          for (const p of batch) referenced.add(`${bucket}/${p}`);
        }
      }
    }
  }
  return referenced;
}

/** Deletes exact object names. Returns how many Storage reported removed, and the keys that failed. */
async function deleteObjects(bucket: string, paths: readonly string[]): Promise<{ removed: number; failed: string[] }> {
  let removed = 0;
  const failed: string[] = [];
  for (const batch of chunk(paths, 100)) {
    if (DRY_RUN) {
      removed += batch.length;
      continue;
    }
    try {
      // `prefixes` is Storage's name for the list of exact object names to remove.
      const res = await fetch(`${storageBase()}/object/${bucket}`, {
        method: 'DELETE',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: batch }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const rows = (await res.json()) as unknown[];
      removed += Array.isArray(rows) ? rows.length : 0;
    } catch (error) {
      for (const p of batch) {
        failed.push(`${bucket}/${p}`);
        console.warn(`  storage: could not delete ${bucket}/${p} — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { removed, failed };
}

/** The upload ledgers on disk, parsed. Invalid lines are logged and never acted on. */
async function readUploadLedgers(): Promise<{ file: string; runId: string; entries: StorageObjectRef[] }[]> {
  const dir = path.join(REPO_ROOT, ARTIFACT_ROOT, UPLOADS_DIR);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const ledgers: { file: string; runId: string; entries: StorageObjectRef[] }[] = [];
  for (const name of names.sort()) {
    const runId = name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : '';
    if (!isRunId(runId)) continue;
    const file = path.join(REPO_ROOT, ...artifactPath({ kind: 'uploads', runId }).split('/'));
    const parsed = parseUploadLedger(await fs.readFile(file, 'utf8'), runId);
    if (parsed.invalidLines.length > 0) {
      console.warn(`  storage: ${name} has ${parsed.invalidLines.length} unreadable line(s) (${parsed.invalidLines.join(', ')}) — ignored`);
    }
    ledgers.push({ file, runId, entries: parsed.entries });
  }
  return ledgers;
}

async function cleanStorage(input: {
  ledgers: { file: string; runId: string; entries: StorageObjectRef[] }[];
  rowCandidates: StorageCandidate[];
  personaIds: ReadonlySet<string>;
  sandboxOwners: ReadonlySet<string>;
}): Promise<number> {
  const candidates: StorageCandidate[] = [
    ...input.ledgers.flatMap((ledger) => ledger.entries.map((e) => ({ ...e, source: 'ledger' as const }))),
    ...(await sweepPersonaFolders(input.personaIds)),
    ...input.rowCandidates,
  ];
  if (candidates.length === 0) {
    console.log('  storage: nothing recorded');
    return 0;
  }

  const plan = planStorageDeletion({
    candidates,
    sandboxOwners: input.sandboxOwners,
    stillReferenced: await stillReferencedKeys(candidates),
  });
  for (const kept of plan.kept) {
    console.warn(`  storage: kept ${kept.bucket}/${kept.path} — ${kept.reason}`);
  }

  let removed = 0;
  const failed = new Set<string>();
  for (const [bucket, paths] of plan.delete) {
    const result = await deleteObjects(bucket, paths);
    removed += result.removed;
    for (const key of result.failed) failed.add(key);
    const verb = DRY_RUN ? 'would delete' : 'deleted';
    console.log(`  storage ${bucket}: ${verb} ${result.removed} of ${paths.length}`);
  }

  // A ledger is retired once every entry was decided without a failed delete; a kept
  // (still referenced) object stays in the sandbox and is not retried.
  for (const ledger of input.ledgers) {
    if (DRY_RUN) continue;
    if (ledger.entries.some((e) => failed.has(objectKey(e)))) {
      console.warn(`  storage: keeping ledger ${ledger.runId} — some objects could not be deleted`);
      continue;
    }
    await fs.rm(ledger.file, { force: true });
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Stripe test objects (Req 2.7). Test keys only; this run's stamp only.
// ---------------------------------------------------------------------------

type StripeClient = ReturnType<typeof testStripe>;

/** Per run: what Stripe will not remove, and whether every search for the run worked. */
type StripeOutcome = Map<string, { left: LeftInStripe[]; complete: boolean }>;

/** Run ids recorded on disk: run manifests and upload ledgers. */
async function runIdsOnDisk(): Promise<string[]> {
  const ids = new Set<string>();
  for (const [dir, strip] of [[RUNS_DIR, ''], [UPLOADS_DIR, '.jsonl']] as const) {
    try {
      for (const name of await fs.readdir(path.join(REPO_ROOT, ARTIFACT_ROOT, dir))) {
        const id = strip && name.endsWith(strip) ? name.slice(0, -strip.length) : name;
        if (isRunId(id)) ids.add(id);
      }
    } catch {
      // No directory: nothing recorded.
    }
  }
  return [...ids];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Applies one decision. Returns a `leftInStripe` entry when the object stays. */
async function actOn(
  type: StripeObjectType,
  id: string,
  decision: ReturnType<typeof decideStripeObject>,
  apply: { cancel?: () => Promise<unknown>; del?: () => Promise<unknown> },
  platform: TestPlatform,
): Promise<LeftInStripe | null> {
  if (decision.action === 'skip' || decision.action === 'done') return null;
  if (decision.action === 'leave') {
    console.warn(`  stripe ${platform}: left ${type} ${id} — ${decision.reason}`);
    return { type, id, reason: decision.reason };
  }
  const run = decision.action === 'cancel' ? apply.cancel : apply.del;
  if (!run) {
    const reason = `cleanup cannot ${decision.action} a ${type}`;
    console.warn(`  stripe ${platform}: left ${type} ${id} — ${reason}`);
    return { type, id, reason };
  }
  if (DRY_RUN) {
    console.log(`  stripe ${platform}: would ${decision.action} ${type} ${id}`);
    return null;
  }
  try {
    await run();
    console.log(`  stripe ${platform}: ${decision.action === 'cancel' ? 'cancelled' : 'deleted'} ${type} ${id}`);
    return null;
  } catch (error) {
    const reason = `could not ${decision.action}: ${errorText(error)}`;
    console.warn(`  stripe ${platform}: ${type} ${id} — ${reason}`);
    return { type, id, reason };
  }
}

async function cleanStripePlatform(
  platform: TestPlatform,
  stripe: StripeClient,
  runIds: readonly string[],
  outcome: StripeOutcome,
): Promise<void> {
  const record = (runId: string, left: LeftInStripe | null) => {
    if (left) outcome.get(runId)?.left.push(left);
  };
  const fail = (runId: string, what: string, error: unknown) => {
    console.warn(`  stripe ${platform}: ${what} failed for run ${runId} — ${errorText(error)}`);
    const entry = outcome.get(runId);
    if (entry) entry.complete = false;
  };

  // Searchable objects: one exact `runSearchQuery` per run. PaymentIntents first, so a
  // Customer is only deleted after its intents were cancelled.
  for (const runId of runIds) {
    const query = runSearchQuery(runId);
    try {
      for (const intent of await stripe.paymentIntents.search({ query, limit: 100 }).autoPagingToArray({ limit: 1000 })) {
        const decision = decideStripeObject({ type: 'payment_intent', runId, metadata: intent.metadata, status: intent.status });
        record(runId, await actOn('payment_intent', intent.id, decision, { cancel: () => stripe.paymentIntents.cancel(intent.id) }, platform));
      }
    } catch (error) {
      fail(runId, 'PaymentIntent search', error);
    }
    try {
      for (const customer of await stripe.customers.search({ query, limit: 100 }).autoPagingToArray({ limit: 1000 })) {
        const decision = decideStripeObject({ type: 'customer', runId, metadata: customer.metadata });
        record(runId, await actOn('customer', customer.id, decision, { del: () => stripe.customers.del(customer.id) }, platform));
      }
    } catch (error) {
      fail(runId, 'Customer search', error);
    }
  }

  // Not searchable: connected accounts and Identity sessions are listed from the oldest
  // run's start onward, and each is acted on only when its OWN run stamp is one of
  // `runIds` (re-checked by `decideStripeObject`).
  const starts = runIds.map((id) => runStartedAt(id)?.getTime()).filter((t): t is number => t !== undefined);
  if (starts.length === 0) return;
  const created = { gte: Math.floor(Math.min(...starts) / 1000) - 300 };
  const wanted = new Set(runIds);
  const runOf = (metadata: Record<string, string> | null | undefined) => metadata?.[E2E_RUN_METADATA_KEY];

  try {
    for (const account of await stripe.accounts.list({ created, limit: 100 }).autoPagingToArray({ limit: 1000 })) {
      const runId = runOf(account.metadata);
      if (!runId || !wanted.has(runId)) continue;
      const decision = decideStripeObject({ type: 'account', runId, metadata: account.metadata });
      record(runId, await actOn('account', account.id, decision, { del: () => stripe.accounts.del(account.id) }, platform));
    }
  } catch (error) {
    for (const runId of runIds) fail(runId, 'connected account list', error);
  }

  try {
    const sessions = await stripe.identity.verificationSessions.list({ created, limit: 100 }).autoPagingToArray({ limit: 1000 });
    for (const session of sessions) {
      const runId = runOf(session.metadata);
      if (!runId || !wanted.has(runId)) continue;
      const decision = decideStripeObject({
        type: 'identity.verification_session',
        runId,
        metadata: session.metadata,
        status: session.status,
      });
      record(
        runId,
        await actOn('identity.verification_session', session.id, decision, {
          cancel: () => stripe.identity.verificationSessions.cancel(session.id),
        }, platform),
      );
    }
  } catch (error) {
    for (const runId of runIds) fail(runId, 'Identity session list', error);
  }
}

async function cleanStripe(runIds: readonly string[]): Promise<StripeOutcome> {
  const outcome: StripeOutcome = new Map(runIds.map((id) => [id, { left: [], complete: true }]));
  for (const platform of TEST_PLATFORMS) {
    let stripe: StripeClient;
    try {
      stripe = testStripe(platform);
    } catch (error) {
      if (error instanceof StripeKeyRefusedError && error.reason === 'missing') {
        // No key, so the run could not have created anything on this platform.
        console.log(`  stripe ${platform}: no test key configured — skipped`);
        continue;
      }
      // A live or non-test key: refuse the platform outright, and say the run is unchecked.
      console.warn(`  stripe ${platform}: ${errorText(error)} — skipped`);
      for (const entry of outcome.values()) entry.complete = false;
      continue;
    }
    await cleanStripePlatform(platform, stripe, runIds, outcome);
    console.log(`  stripe ${platform}: checked ${runIds.length} run(s)`);
  }
  return outcome;
}

/** A manifest for a run the reporter has not written yet. The reporter keeps `leftInStripe`. */
function stubManifest(runId: string): RunManifest {
  return {
    runId,
    startedAt: runStartedAt(runId)?.toISOString() ?? new Date(0).toISOString(),
    commit: 'unknown',
    schema: SCHEMA,
    durationMs: 0,
    servers: [],
    results: [],
    leftInStripe: [],
  };
}

/** Writes each run's `leftInStripe` into its manifest, atomically. */
async function recordLeftInStripe(outcome: StripeOutcome): Promise<void> {
  for (const [runId, { left, complete }] of outcome) {
    const file = path.join(REPO_ROOT, ...artifactPath({ kind: 'manifest', runId }).split('/'));
    let manifest: RunManifest | null = null;
    try {
      manifest = JSON.parse(await fs.readFile(file, 'utf8')) as RunManifest;
    } catch {
      manifest = null;
    }
    if (manifest === null && left.length === 0) continue;
    const base = manifest ?? stubManifest(runId);
    const next = mergeLeftInStripe(Array.isArray(base.leftInStripe) ? base.leftInStripe : [], left, complete);
    if (left.length > 0) console.warn(`  stripe: ${left.length} object(s) left in Stripe test mode for run ${runId}`);
    if (DRY_RUN) continue;
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify({ ...base, leftInStripe: next }, null, 2)}\n`, 'utf8');
    await fs.rename(temp, file);
  }
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
  if (DRY_RUN) console.log('DRY RUN: nothing will be changed.');

  // Shared_Resources facts that must be read while the rows and accounts still exist.
  console.log('\nChecking marked auth accounts for the sandbox flag:');
  const personaIds = await flagUnflaggedSandboxAccounts(profileIds);
  const rowCandidates = await collectRowPaths({ profileIds, itemIds, conversationIds });
  const sandboxOwners = await sandboxOwnersOf(rowCandidates, personaIds);

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
  // cash_sale_items: NOT deleted here. Left to the ON DELETE CASCADE below, because a
  // direct delete is IMPOSSIBLE for any contract that has been paid.
  //
  // `cash_sale_items_frozen_after_agreement` (0064) is a BEFORE INSERT OR UPDATE OR DELETE
  // row trigger that raises "Cash-sale contents are locked once payment has started"
  // whenever the parent sale's status is anything but AGREEMENT. It fires on DELETE too,
  // by design — the freeze is what makes the Commitment_Point mean something, and a
  // deletable line item would be a hole in it.
  //
  // The cascade is not a hole. That trigger's condition is `v_status is not null and
  // v_status <> 'AGREEMENT'`, and the `is not null` half is what makes this work: when the
  // parent `cash_sales` row is deleted, the FK's cascade removes the children in the same
  // transaction, by which point the parent is already gone and the status lookup returns
  // null. Verified against a paid ESCROW_HELD shopfront contract: deleting the parent took
  // all three frozen lines with it.
  //
  // This ran for as long as it did because nothing had cleaned up a PAID shopfront
  // contract before — an unpaid one is still in AGREEMENT and deletes fine, which is why
  // the step looked correct.
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

  // -------------------------------------------------------------------------
  // Shared_Resources. After every row, so the "still referenced" check sees
  // only the rows that survive.
  // -------------------------------------------------------------------------
  console.log('\nRemoving Storage objects (ledger, marked rows, persona folders):');
  const objectsRemoved = await cleanStorage({
    ledgers: await readUploadLedgers(),
    rowCandidates,
    personaIds,
    sandboxOwners,
  });

  console.log('\nRemoving Stripe test objects stamped for this run and recent runs:');
  const runIds = runsToHeal({ current: process.env.E2E_RUN_ID?.trim(), onDisk: await runIdsOnDisk(), now: new Date() });
  if (runIds.length === 0) {
    console.log('  stripe: no run id (E2E_RUN_ID unset and none recorded) — skipped');
  } else {
    await recordLeftInStripe(await cleanStripe(runIds));
  }

  const verb = DRY_RUN ? 'would be removed' : 'removed';
  console.log(`\nDone. ${total} row(s) and ${objectsRemoved} Storage object(s) ${verb}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
