// tests/database/catalogBanVisibility.test.ts
//
// A permanently banned member's goods must not be purchasable by anyone (0091).
//
// WHY THIS IS A DATABASE TEST AND NOT A UNIT TEST. The invariant lives in an RLS policy
// and two triggers, and the bug it guards was invisible from TypeScript: 0059 blocked
// everything the BANNED member could do and nothing about what other members could
// still SEE, so a staff-confirmed fraudster's inventory stayed in the catalog. No unit
// test could have caught that, because no application code was wrong.
//
// The catalog policy previously read only status and closed_at. The pairing that
// matters is a ban landing on a profile and an item's visibility changing as a result,
// which is exactly what these assertions exercise.

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { databaseTestsEnabled, query } from './support/sql';
import {
  createItemFixture,
  destroyCashSaleFixtures,
  type ItemFixture,
} from './support/cashSaleFixture';

const enabled = databaseTestsEnabled();

/** Every profile touched, so a failed assertion cannot leave a live ban behind. */
const banned: string[] = [];
/** Throwaway listings created by these tests. */
let fixtures: ItemFixture[] = [];

describe.skipIf(!enabled)('catalog visibility under a fraud ban', () => {
  afterEach(async () => {
    await destroyCashSaleFixtures(fixtures);
    fixtures = [];
  });

  afterAll(async () => {
    // Runs even when an expectation throws. A leaked ban would hide a real seller's
    // listings from the whole catalog, so this cleanup matters more than the test.
    for (const id of banned) {
      await query(`update cardtrade.profiles set fraud_banned_at = null where id = '${id}'`);
    }
  });

  it('denormalises the ban onto items, in both directions', async () => {
    // ITS OWN ITEM, and scoped to that one row. An earlier version counted a seed
    // seller's listings, and the sibling database tests borrow items and change their
    // status, so the total moved under this test's feet and it failed for a reason that
    // had nothing to do with bans. Visibility of a specific row is the actual invariant.
    const fixture = await createItemFixture();
    fixtures.push(fixture);
    const owners = await query<{ owner_id: string }>(
      `select owner_id from cardtrade.items where id = '${fixture.itemId}'`,
    );
    const owner = owners[0].owner_id;

    /** Whether THIS item satisfies the catalog policy's own predicate. */
    const itemIsVisible = async () => {
      const found = await query<{ c: number }>(`
        select count(*)::int as c from cardtrade.items
        where id = '${fixture.itemId}'
          and status = 'AVAILABLE' and closed_at is null
          and seller_fraud_banned = false
      `);
      return found[0].c === 1;
    };

    expect(await itemIsVisible()).toBe(true);

    banned.push(owner);
    await query(`update cardtrade.profiles set fraud_banned_at = now() where id = '${owner}'`);
    // THE ASSERTION THE GAP FAILED. Their goods leave the catalog the moment the ban
    // lands, without anything having to revisit the listings.
    expect(await itemIsVisible()).toBe(false);

    await query(`update cardtrade.profiles set fraud_banned_at = null where id = '${owner}'`);
    banned.pop();
    // Reversible, because a ban lifted in error must not silently destroy a seller's
    // inventory. The column is derived, not a second source of truth.
    expect(await itemIsVisible()).toBe(true);
  }, 30_000);

  it('sets the flag on a NEW listing by an already-banned member', async () => {
    // The BEFORE INSERT trigger. Without it a banned member could publish straight into
    // the catalog by creating rows after the ban, which the AFTER UPDATE trigger on
    // profiles would never see.
    const sellers = await query<{ owner_id: string }>(`
      select owner_id from cardtrade.items where listing_kind = 'SINGLE' limit 1
    `);
    const owner = sellers[0].owner_id;

    banned.push(owner);
    await query(`update cardtrade.profiles set fraud_banned_at = now() where id = '${owner}'`);

    const fixture = await createItemFixture({ owner_id: `'${owner}'` });
    fixtures.push(fixture);

    const rows = await query<{ seller_fraud_banned: boolean }>(
      `select seller_fraud_banned from cardtrade.items where id = '${fixture.itemId}'`,
    );
    expect(rows[0].seller_fraud_banned).toBe(true);

    await query(`update cardtrade.profiles set fraud_banned_at = null where id = '${owner}'`);
    banned.pop();
  }, 30_000);

  it('keeps the ban check in the catalog policy itself', async () => {
    // Guards against someone "simplifying" the policy back to status and closed_at.
    // The column existing is not the protection; the policy reading it is.
    const rows = await query<{ qual: string }>(`
      select pg_get_expr(polqual, polrelid) as qual
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'cardtrade'
        and c.relname = 'items'
        and polname = 'items_catalog_select'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].qual).toContain('seller_fraud_banned');
  }, 30_000);

  it('exposes no per-profile ban probe to anonymous callers', async () => {
    // The first attempt at 0091 was a SECURITY DEFINER function taking a profile id,
    // granted to anon so the catalog policy could call it. That would have let anyone
    // holding the publishable key test any member's ban status one id at a time. The
    // grants guard rejected it and the denormalised column replaced it; this keeps the
    // reasoning attached to an assertion rather than only to a migration comment.
    const rows = await query<{ proname: string }>(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'cardtrade'
        and p.prosecdef
        and p.pronargs > 0
        and p.proname like '%fraud_banned%'
        and has_function_privilege('anon', p.oid, 'EXECUTE')
    `);
    expect(rows.map((row) => row.proname)).toEqual([]);
  }, 30_000);
});
