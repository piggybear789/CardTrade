// tests/database/grants.test.ts
//
// What a signed-in member may actually write, asserted against the live catalog.
//
// WHY THIS FILE EXISTS, AND WHY IT IS THE MOST VALUABLE TEST IN THE REPOSITORY.
//
// 395 unit and property tests cannot see a grant. Every one of them runs against fakes,
// so a permission regression is invisible to all of them — and permissions are where the
// worst defects in this project have been:
//
//   * `cardtrade.public_profiles` was an auto-updatable view owned by the table owner, so
//     any member could UPDATE or DELETE any other member's profile row (F52).
//   * `authenticated` held INSERT/UPDATE/DELETE on every column of every table, inherited
//     from DEFAULT PRIVILEGES rather than granted by any migration — which is why reading
//     the migrations could not find it (F51).
//   * Six SECURITY DEFINER money functions were executable by `anon` (F53).
//   * And the fix for all that was itself wrong: 0073's column-level INSERT grants had NO
//     EFFECT, because 0072 had already granted INSERT at table level and a narrower grant
//     does not remove a wider one (F70). That defect was caught by exactly the query below
//     and by nothing else.
//
// THE ASSERTIONS RUN IN BOTH DIRECTIONS, and that is the point. Negative checks alone
// would let someone "fix" a failure by revoking a grant the app needs, turning a security
// test into an outage. Positive checks alone are what the app already proves by working.
// Both together mean the surface can only be exactly what is written here.
//
// WHEN THIS FAILS, DO NOT EDIT THE EXPECTATION TO MATCH. Grants are schema: change them
// in a numbered migration and the expectation in the same commit, so the diff shows what
// access changed and why.

import { describe, expect, it } from 'vitest';

import { databaseTestsEnabled, lit, query } from './support/sql';

type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

interface GrantCheck {
  /** What a member is doing, in product terms, so a failure names a broken feature. */
  flow: string;
  table: string;
  /** Omit for a table-level check. */
  column?: string;
  privilege: Privilege;
  role?: 'authenticated' | 'anon';
  /** `true` = the app needs this. `false` = allowing it is a vulnerability. */
  allowed: boolean;
}

/**
 * Writes the application performs through the COOKIE-BOUND client, enumerated from
 * `lib/actions/**`. Every one of these must remain possible.
 *
 * RLS still decides WHICH ROW; these grants decide WHICH COLUMN. Both are required, and
 * this file only checks the second — `tests/database/policies.test.ts` covers the first.
 */
const MUST_WORK: GrantCheck[] = [
  // Profile: `updateProfile`, `setTradingRegion`, `completeOnboarding`, avatar upload.
  { flow: 'profile: edit display name', table: 'profiles', column: 'display_name', privilege: 'UPDATE', allowed: true },
  { flow: 'profile: edit contact email', table: 'profiles', column: 'contact_email', privilege: 'UPDATE', allowed: true },
  { flow: 'profile: set trading region', table: 'profiles', column: 'region_code', privilege: 'UPDATE', allowed: true },
  { flow: 'profile: finish onboarding', table: 'profiles', column: 'onboarding_completed_at', privilege: 'UPDATE', allowed: true },
  { flow: 'profile: change avatar', table: 'profiles', column: 'avatar_path', privilege: 'UPDATE', allowed: true },

  // Listings: `createListing` (SINGLE and SHOPFRONT), `updateListing`, `deleteItem`.
  { flow: 'listing: create sets owner', table: 'items', column: 'owner_id', privilege: 'INSERT', allowed: true },
  { flow: 'listing: create sets title', table: 'items', column: 'title', privilege: 'INSERT', allowed: true },
  { flow: 'listing: create sets fmv', table: 'items', column: 'fmv_cents', privilege: 'INSERT', allowed: true },
  { flow: 'listing: create sets images', table: 'items', column: 'image_paths', privilege: 'INSERT', allowed: true },
  { flow: 'listing: create sets status', table: 'items', column: 'status', privilege: 'INSERT', allowed: true },
  { flow: 'listing: create sets kind', table: 'items', column: 'listing_kind', privilege: 'INSERT', allowed: true },
  { flow: 'listing: shopfront starts hidden', table: 'items', column: 'hidden', privilege: 'INSERT', allowed: true },
  { flow: 'listing: create sets location', table: 'items', column: 'location_label', privilege: 'INSERT', allowed: true },
  { flow: 'listing: edit location label', table: 'items', column: 'location_label', privilege: 'UPDATE', allowed: true },
  { flow: 'listing: edit location point', table: 'items', column: 'location_lat', privilege: 'UPDATE', allowed: true },
  { flow: 'listing: edit location region', table: 'items', column: 'location_country_code', privilege: 'UPDATE', allowed: true },
  { flow: 'listing: delete own', table: 'items', privilege: 'DELETE', allowed: true },

  // Offers: `makeOffer`, `counterOffer`, `respondToOffer`.
  { flow: 'offer: make sets amount', table: 'offers', column: 'amount_cents', privilege: 'INSERT', allowed: true },
  { flow: 'offer: make sets author', table: 'offers', column: 'offered_by', privilege: 'INSERT', allowed: true },
  { flow: 'offer: make sets PENDING', table: 'offers', column: 'status', privilege: 'INSERT', allowed: true },
  { flow: 'offer: counter links parent', table: 'offers', column: 'parent_offer_id', privilege: 'INSERT', allowed: true },
  { flow: 'offer: accept/decline/withdraw', table: 'offers', column: 'status', privilege: 'UPDATE', allowed: true },

  // Chat: `ensureConversation`, `sendMessage`, `markConversationRead`.
  { flow: 'chat: open thread', table: 'conversations', column: 'participant_a', privilege: 'INSERT', allowed: true },
  { flow: 'chat: thread names item', table: 'conversations', column: 'item_id', privilege: 'INSERT', allowed: true },
  { flow: 'chat: bump last message', table: 'conversations', column: 'last_message_at', privilege: 'UPDATE', allowed: true },
  { flow: 'chat: send body', table: 'messages', column: 'body', privilege: 'INSERT', allowed: true },
  { flow: 'chat: send sets sender', table: 'messages', column: 'sender_id', privilege: 'INSERT', allowed: true },
  { flow: 'chat: send names thread', table: 'messages', column: 'conversation_id', privilege: 'INSERT', allowed: true },
  { flow: 'chat: mark read', table: 'messages', column: 'read_at', privilege: 'UPDATE', allowed: true },

  // Notifications, watchlist, reviews, reports.
  { flow: 'notification: mark read', table: 'notifications', column: 'read_at', privilege: 'UPDATE', allowed: true },
  { flow: 'watchlist: save item', table: 'watchlist', column: 'item_id', privilege: 'INSERT', allowed: true },
  { flow: 'watchlist: save sets user', table: 'watchlist', column: 'user_id', privilege: 'INSERT', allowed: true },
  { flow: 'watchlist: unsave', table: 'watchlist', privilege: 'DELETE', allowed: true },
  { flow: 'review: leave rating', table: 'reviews', column: 'rating', privilege: 'INSERT', allowed: true },
  { flow: 'review: leave names reviewee', table: 'reviews', column: 'reviewee_id', privilege: 'INSERT', allowed: true },
  { flow: 'review: leave names contract', table: 'reviews', column: 'source_id', privilege: 'INSERT', allowed: true },
  { flow: 'report: file reason', table: 'reports', column: 'reason', privilege: 'INSERT', allowed: true },
  { flow: 'report: file sets OPEN', table: 'reports', column: 'status', privilege: 'INSERT', allowed: true },

  // Reads the product depends on. A revoke that broke these would empty the catalog.
  { flow: 'read: catalog', table: 'items', privilege: 'SELECT', allowed: true },
  { flow: 'read: own cash sales', table: 'cash_sales', privilege: 'SELECT', allowed: true },
  { flow: 'read: own trades', table: 'trades', privilege: 'SELECT', allowed: true },
  { flow: 'read: own collateral', table: 'pre_auth_holds', privilege: 'SELECT', allowed: true },
  { flow: 'read: contract line items', table: 'cash_sale_items', privilege: 'SELECT', allowed: true },
  { flow: 'read: contract events', table: 'cash_sale_events', privilege: 'SELECT', allowed: true },
  { flow: 'read: trade transitions', table: 'trade_state_transitions', privilege: 'SELECT', allowed: true },
  { flow: 'read: counterparty address', table: 'trade_delivery_details', privilege: 'SELECT', allowed: true },
  { flow: 'read: public profiles', table: 'public_profiles', privilege: 'SELECT', allowed: true },
  { flow: 'read: public profiles anonymously', table: 'public_profiles', privilege: 'SELECT', role: 'anon', allowed: true },
];

/**
 * Access that must NOT exist. Each one names the guard it would defeat, because the
 * reason is the part that stops a future change quietly re-granting it.
 */
const MUST_NOT_WORK: GrantCheck[] = [
  // Self-escalation. `is_admin` opens the moderation console; `identity_check_status` IS
  // the Identity_Gate that unlocks listing, selling and trade escrow.
  { flow: 'ESCALATION: self-grant admin', table: 'profiles', column: 'is_admin', privilege: 'UPDATE', allowed: false },
  { flow: 'ESCALATION: self-grant support', table: 'profiles', column: 'is_support', privilege: 'UPDATE', allowed: false },
  { flow: 'ESCALATION: self-verify identity', table: 'profiles', column: 'identity_check_status', privilege: 'UPDATE', allowed: false },
  { flow: 'ESCALATION: self-approve payouts', table: 'profiles', column: 'merchant_status', privilege: 'UPDATE', allowed: false },
  { flow: 'ESCALATION: enable own settlements', table: 'profiles', column: 'merchant_settlements_enabled', privilege: 'UPDATE', allowed: false },
  { flow: 'ESCALATION: forge verified name', table: 'profiles', column: 'identity_check_name', privilege: 'UPDATE', allowed: false },
  // F55: a member whose profile row is missing could otherwise INSERT one as an admin.
  { flow: 'ESCALATION: insert own profile row', table: 'profiles', privilege: 'INSERT', allowed: false },

  // F52: the public projection is a read-only view onto profiles.
  { flow: 'RLS BYPASS: write via public_profiles', table: 'public_profiles', privilege: 'UPDATE', allowed: false },
  { flow: 'RLS BYPASS: insert via public_profiles', table: 'public_profiles', privilege: 'INSERT', allowed: false },
  { flow: 'RLS BYPASS: delete via public_profiles', table: 'public_profiles', privilege: 'DELETE', allowed: false },

  // Listing tampering. Each defeats a guard that exists in a Server Action.
  { flow: 'TAMPER: unhide after moderation', table: 'items', column: 'hidden', privilege: 'UPDATE', allowed: false },
  { flow: 'TAMPER: move FMV while reserved', table: 'items', column: 'fmv_cents', privilege: 'UPDATE', allowed: false },
  { flow: 'TAMPER: force listing status', table: 'items', column: 'status', privilege: 'UPDATE', allowed: false },
  { flow: 'TAMPER: fake verified badge', table: 'items', column: 'seller_identity_verified', privilege: 'UPDATE', allowed: false },
  { flow: 'TAMPER: fake verified badge at insert', table: 'items', column: 'seller_identity_verified', privilege: 'INSERT', allowed: false },
  { flow: 'TAMPER: fake seller rating', table: 'items', column: 'seller_rating', privilege: 'UPDATE', allowed: false },
  { flow: 'TAMPER: fake seller rating at insert', table: 'items', column: 'seller_rating', privilege: 'INSERT', allowed: false },
  { flow: 'TAMPER: set own currency', table: 'items', column: 'currency', privilege: 'INSERT', allowed: false },
  { flow: 'TAMPER: close shopfront directly', table: 'items', column: 'closed_at', privilege: 'UPDATE', allowed: false },
  { flow: 'TAMPER: reassign listing owner', table: 'items', column: 'owner_id', privilege: 'UPDATE', allowed: false },

  // Offer tampering. `respondToOffer` reads the amount off the row at accept time, and
  // `offered_by` decides who is allowed to accept.
  { flow: 'TAMPER: rewrite offer amount', table: 'offers', column: 'amount_cents', privilege: 'UPDATE', allowed: false },
  { flow: 'TAMPER: repoint offer author', table: 'offers', column: 'offered_by', privilege: 'UPDATE', allowed: false },
  { flow: 'TAMPER: move offer to another buyer', table: 'offers', column: 'buyer_id', privilege: 'UPDATE', allowed: false },

  // Chat is the evidence an arbitrator reads.
  { flow: 'EVIDENCE: rewrite a message body', table: 'messages', column: 'body', privilege: 'UPDATE', allowed: false },
  { flow: 'EVIDENCE: promote message to SYSTEM', table: 'messages', column: 'kind', privilege: 'UPDATE', allowed: false },
  { flow: 'EVIDENCE: forge SYSTEM at insert', table: 'messages', column: 'kind', privilege: 'INSERT', allowed: false },
  { flow: 'EVIDENCE: forge contract event', table: 'messages', column: 'system_event', privilege: 'INSERT', allowed: false },
  { flow: 'EVIDENCE: reassign a message sender', table: 'messages', column: 'sender_id', privilege: 'UPDATE', allowed: false },
  { flow: 'EVIDENCE: swap the other participant', table: 'conversations', column: 'participant_b', privilege: 'UPDATE', allowed: false },
  { flow: 'EVIDENCE: repoint thread at a trade', table: 'conversations', column: 'trade_id', privilege: 'UPDATE', allowed: false },

  // Reputation. `profiles.rating` is trigger-maintained from these rows.
  { flow: 'TAMPER: repoint a review', table: 'reviews', column: 'reviewee_id', privilege: 'UPDATE', allowed: false },
  { flow: 'TAMPER: change a review rating', table: 'reviews', column: 'rating', privilege: 'UPDATE', allowed: false },

  // Moderation queue.
  { flow: 'TAMPER: resolve own report', table: 'reports', column: 'status', privilege: 'UPDATE', allowed: false },
  { flow: 'TAMPER: forge report reviewer', table: 'reports', column: 'reviewed_by', privilege: 'INSERT', allowed: false },
  { flow: 'TAMPER: forge a notification', table: 'notifications', privilege: 'INSERT', allowed: false },

  // The money tables. Every write is the service role's, through an orchestrator.
  { flow: 'MONEY: write a cash sale', table: 'cash_sales', privilege: 'UPDATE', allowed: false },
  { flow: 'MONEY: insert a cash sale', table: 'cash_sales', privilege: 'INSERT', allowed: false },
  { flow: 'MONEY: write a trade', table: 'trades', privilege: 'UPDATE', allowed: false },
  { flow: 'MONEY: write collateral', table: 'pre_auth_holds', privilege: 'UPDATE', allowed: false },
  { flow: 'MONEY: add a trade bundle item', table: 'trade_items', privilege: 'INSERT', allowed: false },
  { flow: 'MONEY: write a trade fee', table: 'trade_fees', privilege: 'UPDATE', allowed: false },
  { flow: 'MONEY: write a contract line item', table: 'cash_sale_items', privilege: 'UPDATE', allowed: false },
  { flow: 'MONEY: write a delivery address', table: 'trade_delivery_details', privilege: 'UPDATE', allowed: false },
  { flow: 'MONEY: forge a webhook log', table: 'webhook_logs', privilege: 'INSERT', allowed: false },
  { flow: 'MONEY: edit the region table', table: 'regions', privilege: 'UPDATE', allowed: false },
  { flow: 'MONEY: write an arbitration note', table: 'arbitration_notes', privilege: 'INSERT', allowed: false },
];

const ALL_CHECKS = [...MUST_WORK, ...MUST_NOT_WORK];

/** One row per check: the label, what we expect, and what the catalog says. */
function buildQuery(checks: GrantCheck[]): string {
  const rows = checks.map((check, index) => {
    const role = check.role ?? 'authenticated';
    const relation = `cardtrade.${check.table}`;
    const call = check.column
      ? `has_column_privilege(${lit(role)}, ${lit(relation)}, ${lit(check.column)}, ${lit(check.privilege)})`
      : `has_table_privilege(${lit(role)}, ${lit(relation)}, ${lit(check.privilege)})`;
    return `select ${index} as idx, ${check.allowed} as expected, ${call} as actual`;
  });
  return rows.join('\nunion all\n');
}

interface CheckRow {
  idx: number;
  expected: boolean;
  actual: boolean;
}

const enabled = databaseTestsEnabled();

describe.skipIf(!enabled)('member write surface (live catalog)', () => {
  it('grants exactly the access the application needs, and nothing more', async () => {
    const rows = await query<CheckRow>(buildQuery(ALL_CHECKS));

    // A query that returned nothing must fail loudly rather than pass vacuously.
    expect(rows).toHaveLength(ALL_CHECKS.length);

    const mismatches = rows
      .filter((row) => row.expected !== row.actual)
      .map((row) => {
        const check = ALL_CHECKS[row.idx];
        const target = check.column ? `${check.table}.${check.column}` : check.table;
        const verdict = row.actual ? 'IS ALLOWED but must not be' : 'IS DENIED but is needed';
        return `${check.flow} — ${check.privilege} on ${target} ${verdict}`;
      });

    expect(mismatches, mismatches.join('\n')).toEqual([]);
  }, 30_000);

  it('leaves no callable SECURITY DEFINER function in cardtrade reachable by anon', async () => {
    // F53: six money-mutating RPCs kept PostgreSQL's default EXECUTE TO PUBLIC, so an
    // unauthenticated caller holding the publishable key could set an arbitrary refund
    // amount, queue a payout, or file a fraud claim attributed to someone else.
    //
    // TWO EXCLUSIONS, both deliberate.
    //
    // Trigger functions — anything returning `trigger` — are not an API surface: PostgREST
    // will not expose them, calling one directly raises, and a trigger firing does not
    // consult EXECUTE on its function at all. Revoking them would buy nothing.
    //
    // `is_admin`, `is_staff` and `is_fraud_banned` are called BY RLS POLICIES as the
    // member, so revoking EXECUTE would deny every policy that depends on them — turning
    // a hardening step into a lockout.
    const rows = await query<{ proname: string; args: string }>(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'cardtrade'
        and p.prosecdef
        and p.prorettype <> 'pg_catalog.trigger'::regtype
        and p.proname not in ('is_admin', 'is_staff', 'is_fraud_banned')
        and has_function_privilege('anon', p.oid, 'EXECUTE')
      order by p.proname
    `);

    const names = rows.map((row) => `${row.proname}(${row.args})`);
    expect(names, `callable by anon:\n${names.join('\n')}`).toEqual([]);
  }, 30_000);

  it('never hands out write access through DEFAULT PRIVILEGES', async () => {
    // F51, the root cause: `pg_default_acl` carried `authenticated=arwd`, so every
    // relation created in this schema inherited member write access. A migration adding a
    // table would silently re-open everything the grants above lock down, which is why
    // this is asserted rather than assumed.
    const rows = await query<{ default_acl: string }>(`
      select unnest(d.defaclacl)::text as default_acl
      from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = 'cardtrade' and d.defaclobjtype = 'r'
    `);

    const memberGrants = rows
      .map((row) => row.default_acl)
      .filter((acl) => acl.startsWith('authenticated=') || acl.startsWith('anon='));

    // `r` (SELECT) is acceptable; a, w and d are insert, update and delete.
    const withWrites = memberGrants.filter((acl) => /=[^/]*[awd]/.test(acl));
    expect(withWrites, `default privileges granting writes: ${withWrites.join(', ')}`).toEqual([]);
  }, 30_000);
});

describe.skipIf(enabled)('member write surface (skipped)', () => {
  it('needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_PAT in .env.local', () => {
    // Present so a run without credentials reports a skip rather than silently
    // containing no security coverage at all.
    expect(enabled).toBe(false);
  });
});
