// tests/database/policies.test.ts
//
// Row-level security as the database actually has it.
//
// `grants.test.ts` asserts WHICH COLUMN a member may write. This file asserts the other
// half of the same guarantee: that RLS is switched on at all, and that no permissive
// write policy has been left stranded without a grant behind it.
//
// WHY THE SECOND CHECK MATTERS. Narrowing grants is exactly how a feature gets broken
// quietly: the policy still says a member may do the thing, the grant no longer allows it,
// and nothing fails until someone tries. Thirteen policies in this schema are currently
// inert, every one of them deliberately — service-role paths, an already-denying policy,
// and one retired capability. Pinning that list means the FOURTEENTH shows up as a test
// failure instead of as a support ticket.

import { describe, expect, it } from 'vitest';

import { databaseTestsEnabled, query } from './support/sql';

/**
 * Every table holding member or money data. RLS off on any of these means the grants are
 * the only thing standing between one member and another's rows.
 *
 * `pre_auth_holds` is here for a specific reason: no migration ever enabled RLS on it
 * (0002 covers four tables and defers the collateral table to a migration that contains
 * no policy), so its protection existed only in the deployed database until 0076. This
 * assertion is what stops that recurring.
 */
const TABLES_REQUIRING_RLS = [
  'profiles',
  'items',
  'trades',
  'cash_sales',
  'pre_auth_holds',
  'trade_items',
  'trade_fees',
  'trade_delivery_details',
  'cash_sale_items',
  'cash_sale_events',
  'cash_sale_delivery_details',
  'trade_state_transitions',
  'conversations',
  'messages',
  'notifications',
  'offers',
  'reports',
  'reviews',
  'watchlist',
  'webhook_logs',
  'charge_disputes',
  'arbitration_assignments',
  'arbitration_notes',
];

/**
 * Permissive write policies with no grant behind them, and why each is correct.
 *
 * Format is `table:PRIVILEGE`. Keep the reasons — an entry without one is indistinguishable
 * from an accident.
 */
const KNOWN_INERT_POLICIES: Record<string, string> = {
  // Written by `lib/actions/arbitration.ts` through the service-role client. Staff have no
  // reason to reach these over the API, and the read policy already gates who sees them.
  'arbitration_assignments:INSERT': 'service-role only (assignArbitrationCase)',
  'arbitration_assignments:UPDATE': 'service-role only (assignArbitrationCase)',
  'arbitration_assignments:DELETE': 'service-role only (release a case)',
  'arbitration_notes:INSERT': 'service-role only (addArbitrationNote)',

  // Triaged by admins through the service-role client in `lib/actions/admin.ts`.
  'reports:UPDATE': 'service-role only (admin triage)',

  // F55: both provisioning paths use the service role, and a member INSERT here allowed
  // self-granting `is_admin`.
  'profiles:INSERT': 'deliberately revoked — see F55',

  // No product surface deletes either of these. Least privilege, not a break.
  'notifications:DELETE': 'no dismiss feature exists',
  'reviews:DELETE': 'no withdraw-review feature exists',
  'reviews:UPDATE': 'a review is written once; editing defeats leaveReview guards',
  'watchlist:UPDATE': 'a watchlist row is inserted or deleted, never updated',

  // The policy is `using (false)`, so it denies regardless of any grant.
  'webhook_logs:INSERT': 'policy denies all access anyway',
  'webhook_logs:UPDATE': 'policy denies all access anyway',
  'webhook_logs:DELETE': 'policy denies all access anyway',
};

const enabled = databaseTestsEnabled();

describe.skipIf(!enabled)('row-level security (live catalog)', () => {
  it('has RLS enabled on every table holding member or money data', async () => {
    const rows = await query<{ relname: string; rls_enabled: boolean }>(`
      select c.relname, c.relrowsecurity as rls_enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'cardtrade'
        and c.relkind = 'r'
      order by c.relname
    `);

    const state = new Map(rows.map((row) => [row.relname, row.rls_enabled]));

    const missing = TABLES_REQUIRING_RLS.filter((table) => state.get(table) !== true);
    const absent = TABLES_REQUIRING_RLS.filter((table) => !state.has(table));

    expect(absent, `tables not found in cardtrade: ${absent.join(', ')}`).toEqual([]);
    expect(missing, `RLS is OFF on: ${missing.join(', ')}`).toEqual([]);
  }, 30_000);

  it('has no permissive write policy left stranded without a grant', async () => {
    // Resolved by OID rather than by building a name, because the planner can evaluate a
    // privilege call on a row before the schema filter has excluded it — which made an
    // earlier version of this query fail on another schema's table.
    const rows = await query<{ relname: string; cmd: string }>(`
      with pol as (
        select c.oid as relid, c.relname, pol.polcmd
        from pg_policy pol
        join pg_class c on c.oid = pol.polrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'cardtrade' and pol.polpermissive
      ),
      expanded as (
        select relid, relname, 'INSERT' as cmd from pol where polcmd in ('a', '*')
        union select relid, relname, 'UPDATE' from pol where polcmd in ('w', '*')
        union select relid, relname, 'DELETE' from pol where polcmd in ('d', '*')
      )
      select e.relname, e.cmd
      from expanded e
      where not has_table_privilege('authenticated', e.relid, e.cmd)
        and (
          select count(*) from information_schema.column_privileges cp
          where cp.table_schema = 'cardtrade'
            and cp.table_name = e.relname
            and cp.grantee = 'authenticated'
            and cp.privilege_type = e.cmd
        ) = 0
      order by e.relname, e.cmd
    `);

    const found = rows.map((row) => `${row.relname}:${row.cmd}`);
    const unexpected = found.filter((key) => !(key in KNOWN_INERT_POLICIES));
    const documentedButGone = Object.keys(KNOWN_INERT_POLICIES).filter(
      (key) => !found.includes(key),
    );

    // A NEW inert policy is the interesting case: a policy says a member may write and
    // no grant allows it, so a feature is broken in a way nothing else would surface.
    expect(
      unexpected,
      `policies with no grant behind them (a feature may be broken):\n${unexpected.join('\n')}`,
    ).toEqual([]);

    // And the reverse: an entry here that is no longer inert means access was widened.
    // Not a vulnerability by itself — `grants.test.ts` owns that question — but this list
    // has gone stale and should not keep claiming otherwise.
    expect(
      documentedButGone,
      `no longer inert, so remove from KNOWN_INERT_POLICIES:\n${documentedButGone.join('\n')}`,
    ).toEqual([]);
  }, 30_000);

  it('keeps the fraud-ban lockout RESTRICTIVE wherever it is applied', async () => {
    // A RESTRICTIVE policy can only subtract access. If one of these were ever recreated
    // as PERMISSIVE it would GRANT every non-banned member full access to that table —
    // on `cash_sales`, `trades` and `pre_auth_holds` that is the whole money surface.
    const rows = await query<{ relname: string; permissive: boolean }>(`
      select c.relname, pol.polpermissive as permissive
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'cardtrade' and pol.polname = 'fraud_banned_no_access'
      order by c.relname
    `);

    expect(rows.length).toBeGreaterThan(0);
    const permissiveOnes = rows.filter((row) => row.permissive).map((row) => row.relname);
    expect(
      permissiveOnes,
      `fraud_banned_no_access is PERMISSIVE (so it GRANTS access) on: ${permissiveOnes.join(', ')}`,
    ).toEqual([]);
  }, 30_000);
});
