// scripts/dump-demo-seed.ts
//
// Regenerate `supabase/seeds/demo_lifecycle.sql` from whatever the demo fixture
// currently looks like in the database.
//
// WHY A GENERATOR AND NOT A HAND-WRITTEN FILE. The fixture is ~120 rows across 10
// tables, several of which have 80 columns. Transcribing that by hand is how a seed
// file drifts from the thing it is supposed to reproduce. This reads the rows back and
// emits them as `jsonb_populate_recordset` inserts, which are column-order independent
// and survive a schema change that adds a nullable column.
//
// THE FIXTURE IS IDENTIFIED BY ITS IDS, not by a table or a flag: every seeded row's
// uuid ends in a `5eed...` marker group, so one predicate selects the whole fixture and
// the generated file can drop it cleanly before re-inserting.
//
// TIME. Rows are dumped with their absolute timestamps plus an `anchor` recorded at dump
// time; the generated file shifts every timestamp by `now() - anchor` on load. That is
// what keeps an ACTIVE card authorisation looking live rather than lapsed a month later.
//
// Run: npx tsx --env-file=.env.local scripts/dump-demo-seed.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The marker every seeded uuid carries in its last group. */
const SEED_PREFIX = '00000000-0000-4000-8000-5eed';

/**
 * Insert order is FK order. `auth.users` is handled separately because it lives in
 * another schema and only needs the shell columns.
 */
const TABLES = [
  'profiles',
  'items',
  'cash_sales',
  'cash_sale_events',
  'trades',
  'pre_auth_holds',
  'deals',
  'deal_holds',
  'deal_payments',
  'deal_events',
  'charge_disputes',
] as const;

/**
 * Columns Postgres computes itself. They come back from a read but cannot be written, so
 * the generated insert must name every OTHER column explicitly rather than `select *`.
 *
 * Kept as a declared list because PostgREST does not expose `information_schema`, and a
 * generator that silently dropped a column it could not classify would produce a seed
 * file that loads with data missing.
 */
const GENERATED_COLUMNS: Record<string, readonly string[]> = {
  // Maintained by Postgres from title/description/category for full-text search.
  items: ['search_tsv'],
};

const OUTPUT = resolve(process.cwd(), 'supabase/seeds/demo_lifecycle.sql');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Run with --env-file=.env.local`);
  return value;
}

/**
 * Read a table through PostgREST directly rather than through `supabase-js`.
 *
 * The SDK constructs a Realtime client eagerly and refuses to initialise without a
 * native WebSocket, which Node 20 does not provide. This script only ever does
 * authenticated reads, so the REST endpoint is both sufficient and one dependency
 * lighter.
 */
async function selectSeedRows(table: string): Promise<Record<string, unknown>[]> {
  const url = new URL(`${requireEnv('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/${table}`);
  url.searchParams.set('select', '*');
  // A uuid column has no LIKE operator, so the marker is expressed as the uuid RANGE it
  // describes. Byte-order comparison on uuid makes this exactly equivalent to the
  // `id::text like '...5eed%'` predicate the generated SQL uses.
  url.searchParams.append('id', `gte.${SEED_PREFIX}00000000`);
  url.searchParams.append('id', `lte.${SEED_PREFIX}ffffffff`);
  url.searchParams.set('order', 'id.asc');

  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Accept-Profile': 'cardtrade',
    },
  });

  if (!response.ok) {
    throw new Error(`${table}: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as Record<string, unknown>[];
}

async function main(): Promise<void> {
  const anchor = new Date().toISOString();
  const sections: string[] = [];

  for (const table of TABLES) {
    const rows = await selectSeedRows(table);
    if (rows.length === 0) {
      sections.push(`-- ${table}: no fixture rows\n`);
      continue;
    }

    const generated = new Set(GENERATED_COLUMNS[table] ?? []);
    const columns = Object.keys(rows[0]).filter((name) => !generated.has(name));
    const columnList = columns.map((name) => `"${name}"`).join(', ');

    // Doubling single quotes is the only escaping a dollar-quote-free literal needs, and
    // JSON.stringify has already handled everything inside the payload.
    const payload = JSON.stringify(rows).replace(/'/g, "''");
    sections.push(
      [
        `-- ${table}: ${rows.length} row(s)`,
        `insert into cardtrade.${table} (${columnList})`,
        `select ${columnList}`,
        `from jsonb_populate_recordset(null::cardtrade.${table}, '${payload}'::jsonb);`,
        '',
      ].join('\n'),
    );
  }

  const emails = (await selectSeedRows('profiles')) as unknown as {
    id: string;
    contact_email: string | null;
  }[];

  const userShells = emails
    .map(
      (row) =>
        `  ('00000000-0000-0000-0000-000000000000', '${row.id}', 'authenticated', 'authenticated', '${row.contact_email ?? `${row.id}@noditto.test`}')`,
    )
    .join(',\n');

  const file = `-- supabase/seeds/demo_lifecycle.sql
--
-- GENERATED FILE. Produced by \`npx tsx --env-file=.env.local scripts/dump-demo-seed.ts\`.
-- Edit the fixture in a database and re-run the dump; do not hand-edit this file.
--
-- WHAT THIS IS. One row per stage of every contract CardTrade supports, so the whole
-- lifecycle can be exercised without driving each transaction by hand:
--
--   * 13 Cash_Sales   — all 11 \`cash_sale_status\` values, plus the three COMPLETED
--                       payout variants (SETTLED, PENDING = still owed, FAILED = stuck).
--   * 10 Trades       — all 7 \`trade_state\` values, including a DISPUTED trade with a
--                       fraud claim (HIGH priority in the arbitration queue), a
--                       COLLATERAL_PENDING trade whose bonds FAILED, and a COMPLETED
--                       trade that got there via a resolved Condition_Dispute.
--   * 11 Deals        — all 8 \`deal_state\` values, plus all three
--                       \`deal_dispute_outcome\` values (REFUND_PAYER, SPLIT,
--                       RELEASE_RECIPIENT) so an arbitrated unwind is distinguishable
--                       from a pre-binding cancellation.
--   * 2 Chargebacks   — one open with an evidence deadline, one closed as \`lost\`.
--
-- IDENTIFICATION AND TEARDOWN. Every seeded uuid ends in a \`5eed\` marker group, so the
-- whole fixture is one predicate: \`id::text like '${SEED_PREFIX}%'\`.
-- The teardown block below uses exactly that.
--
-- THE ACCOUNTS CANNOT BE SIGNED INTO. The \`auth.users\` rows carry no
-- \`encrypted_password\` and no confirmed email; they exist only to satisfy
-- \`profiles_id_fkey\`. Impersonate a fixture member by reading their data as staff, or
-- attach a real account to the fixture yourself.
--
-- ONE DELIBERATE DEVIATION, RECORDED. Dev Malhotra (\`...5eed00000a04\`) is
-- \`merchant_status = PENDING\` with a payer on file, which is what makes trade
-- collateral exist at all: under the Bond Policy a VERIFIED trader is bond-exempt, so a
-- verified-to-verified trade posts nothing and every DISPUTED / FRAUD_RESOLVED path
-- would have no collateral to capture. \`proposeTradeAction\` currently gates BOTH
-- parties on the Identity_Gate (Req 14.2), so this configuration is not reachable
-- through the UI today — see the note in \`.kiro/steering/product.md\`.
--
-- LIVE CATALOG WARNING. Fixture items with status AVAILABLE are visible in the public
-- catalog. Run the teardown before a public launch.

begin;

-- --------------------------------------------------------------------------
-- Teardown: remove any previous run of this fixture.
-- Child rows first; \`items\` and \`profiles\` are last because everything references them.
-- --------------------------------------------------------------------------
delete from cardtrade.arbitration_notes where case_ref::text like '${SEED_PREFIX}%';
delete from cardtrade.arbitration_assignments where case_ref::text like '${SEED_PREFIX}%';
delete from cardtrade.charge_disputes where id::text like '${SEED_PREFIX}%';
delete from cardtrade.deal_events where id::text like '${SEED_PREFIX}%';
delete from cardtrade.deal_payments where id::text like '${SEED_PREFIX}%';
delete from cardtrade.deal_holds where id::text like '${SEED_PREFIX}%';
delete from cardtrade.deals where id::text like '${SEED_PREFIX}%';
delete from cardtrade.pre_auth_holds where id::text like '${SEED_PREFIX}%';
delete from cardtrade.trades where id::text like '${SEED_PREFIX}%';
delete from cardtrade.cash_sale_events where id::text like '${SEED_PREFIX}%';
delete from cardtrade.cash_sales where id::text like '${SEED_PREFIX}%';
delete from cardtrade.items where id::text like '${SEED_PREFIX}%';
delete from cardtrade.profiles where id::text like '${SEED_PREFIX}%';
delete from auth.users where id::text like '${SEED_PREFIX}%';

-- --------------------------------------------------------------------------
-- Auth shells. No password, no confirmed email: these accounts are unusable for
-- sign-in by construction, which is the point.
-- --------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
${userShells};

-- --------------------------------------------------------------------------
-- Fixture rows.
-- --------------------------------------------------------------------------
${sections.join('\n')}
-- --------------------------------------------------------------------------
-- Re-anchor every timestamp to load time.
--
-- Without this an ACTIVE card authorisation dumped today reads as long-lapsed next
-- month, and the fixture stops demonstrating the thing it exists to demonstrate. The
-- shift is applied uniformly so the ORDER of events is preserved exactly.
-- --------------------------------------------------------------------------
do $reanchor$
declare
  drift interval := now() - '${anchor}'::timestamptz;
  target record;
  col record;
begin
  for target in
    select unnest(array[
      'profiles','items','cash_sales','cash_sale_events','trades','pre_auth_holds',
      'deals','deal_holds','deal_payments','deal_events','charge_disputes'
    ]) as tbl
  loop
    for col in
      select column_name
      from information_schema.columns
      where table_schema = 'cardtrade'
        and table_name = target.tbl
        and data_type = 'timestamp with time zone'
    loop
      execute format(
        'update cardtrade.%I set %I = %I + $1 where id::text like $2 and %I is not null',
        target.tbl, col.column_name, col.column_name, col.column_name
      ) using drift, '${SEED_PREFIX}%';
    end loop;
  end loop;
end
$reanchor$;

commit;
`;

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, file, 'utf8');
  process.stdout.write(`Wrote ${OUTPUT}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
