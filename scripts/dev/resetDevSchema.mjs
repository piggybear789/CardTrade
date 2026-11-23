// scripts/dev/resetDevSchema.mjs
//
// Rebuild the dev sandbox schema `cardtrade_dev` as a structural clone of production
// `cardtrade`, in the same Supabase project, then load the e2e seed into it.
//
//   npm run dev:db:reset            drop, clone, seed
//   npm run dev:db:reset -- --no-seed
//
// WHY A CATALOG CLONE AND NOT A MIGRATION REPLAY. Several migrations were applied with
// `execute_sql` and have no history row, a handful of tables were created directly
// against the remote database (see scripts/e2e/cleanup-test-data.ts), and the
// migrations also schedule cron jobs, create buckets and backfill production data. The
// live catalog is the only complete description of the schema, so this reads it with
// an empty search_path (every name comes back qualified) and renames `cardtrade` to
// `cardtrade_dev` (`toDev` in ./lib.mjs).
//
// WHAT IS CLONED: enums, sequences, tables (columns, defaults, generated columns),
// constraints, indexes, views, functions, triggers, RLS flags and policies, table /
// column / function / sequence grants, replica identity, Realtime publication
// membership, and the reference rows in `regions` and `categories`.
//
// WHAT IS NOT: production rows; pg_cron jobs (run a job by hand with
// `select cardtrade_dev.<job>()` when a test needs it); Storage buckets and `auth.users`,
// which the two schemas share.
//
// SAFETY. Only ever drops `cardtrade_dev`, a constant. Reads `cardtrade` and never
// writes to it. Seeded sandbox accounts are tagged `app_metadata.sandbox = true` and
// get the password in E2E_SEED_PASSWORD rather than the public one in seed.sql.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEV_SCHEMA,
  SOURCE_SCHEMA,
  ident,
  literal,
  loadEnv,
  projectRef,
  query,
  toDev,
} from './lib.mjs';
import { seedImages } from './seedImages.mjs';

const env = loadEnv();
const withSeed = !process.argv.includes('--no-seed');
const REFERENCE_TABLES = ['regions', 'categories'];

if (DEV_SCHEMA === SOURCE_SCHEMA || !DEV_SCHEMA.endsWith('_dev')) {
  throw new Error(`Refusing to drop "${DEV_SCHEMA}".`);
}

const Q = (sql) => query(env, `set search_path = '';\n${sql}`);
const src = literal(SOURCE_SCHEMA);
const nsp = `${src}::regnamespace`;

console.log(`Reading the ${SOURCE_SCHEMA} catalog on ${projectRef(env)}…`);

const [
  enums,
  sequences,
  columns,
  tables,
  constraints,
  indexes,
  views,
  functions,
  triggers,
  policies,
  relAcls,
  colAcls,
  fnAcls,
  publication,
  schemaAcl,
] = await Promise.all([
  Q(`select t.typname as name, to_json(array_agg(e.enumlabel order by e.enumsortorder)) as labels
     from pg_type t join pg_enum e on e.enumtypid = t.oid
     where t.typnamespace = ${nsp} group by t.typname order by t.typname;`),
  Q(`select s.sequencename as name, s.data_type::text as type, s.start_value, s.min_value,
            s.max_value, s.increment_by, s.cycle, s.cache_size,
            (select c2.relname || '.' || a.attname from pg_depend d
               join pg_class c2 on c2.oid = d.refobjid
               join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
              where d.classid = 'pg_class'::regclass and d.objid = (${src} || '.' || s.sequencename)::regclass
                and d.deptype = 'a' limit 1) as owned_by
     from pg_sequences s where s.schemaname = ${src} order by 1;`),
  Q(`select c.relname as tbl, a.attname as col, format_type(a.atttypid, a.atttypmod) as type,
            a.attnotnull as notnull, a.attgenerated as generated,
            pg_get_expr(d.adbin, d.adrelid) as expr,
            case when a.attcollation <> t.typcollation and a.attcollation <> 0
                 then (select quote_ident(collname) from pg_collation where oid = a.attcollation) end as collation
     from pg_class c
     join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     join pg_type t on t.oid = a.atttypid
     left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
     where c.relnamespace = ${nsp} and c.relkind = 'r'
     order by c.relname, a.attnum;`),
  Q(`select relname as name, relrowsecurity as rls, relforcerowsecurity as force_rls,
            relreplident::text as replident
     from pg_class where relnamespace = ${nsp} and relkind = 'r' order by relname;`),
  Q(`select c.relname as tbl, k.conname as name, k.contype::text as type, pg_get_constraintdef(k.oid) as def
     from pg_constraint k join pg_class c on c.oid = k.conrelid
     where c.relnamespace = ${nsp} and c.relkind = 'r' and k.contype in ('p','u','x','c','f')
     order by case k.contype when 'p' then 0 when 'u' then 1 when 'x' then 2 when 'c' then 3 else 4 end,
              c.relname, k.conname;`),
  Q(`select pg_get_indexdef(i.indexrelid) as def
     from pg_index i join pg_class c on c.oid = i.indrelid
     where c.relnamespace = ${nsp}
       and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid and k.contype in ('p','u','x'))
     order by 1;`),
  Q(`select c.relname as name, pg_get_viewdef(c.oid) as def,
            coalesce(array_to_string(c.reloptions, ', '), '') as options
     from pg_class c where c.relnamespace = ${nsp} and c.relkind = 'v' order by 1;`),
  Q(`select p.proname as name, pg_get_functiondef(p.oid) as def
     from pg_proc p where p.pronamespace = ${nsp} and p.prokind = 'f' order by 1, p.oid;`),
  Q(`select c.relname as tbl, t.tgname as name, pg_get_triggerdef(t.oid) as def, t.tgenabled::text as enabled
     from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = ${nsp} and not t.tgisinternal order by 1, 2;`),
  Q(`select c.relname as tbl, p.polname as name, p.polcmd::text as cmd, p.polpermissive as permissive,
            to_json(array(select case when r = 0 then 'public' else r::regrole::text end from unnest(p.polroles) r)) as roles,
            pg_get_expr(p.polqual, p.polrelid) as qual, pg_get_expr(p.polwithcheck, p.polrelid) as check
     from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relnamespace = ${nsp} order by 1, 2;`),
  Q(`select c.relname as name, c.relkind::text as kind,
            case when x.grantee = 0 then 'public' else x.grantee::regrole::text end as grantee,
            x.privilege_type as priv, x.is_grantable as grantable
     from pg_class c, aclexplode(c.relacl) x
     where c.relnamespace = ${nsp} and c.relkind in ('r','v','S') and x.grantee <> c.relowner
     order by 1, 3, 4;`),
  Q(`select c.relname as name, a.attname as col,
            case when x.grantee = 0 then 'public' else x.grantee::regrole::text end as grantee,
            x.privilege_type as priv
     from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped,
          aclexplode(a.attacl) x
     where c.relnamespace = ${nsp} order by 1, 2, 3;`),
  Q(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
            case when x.grantee = 0 then 'public' else x.grantee::regrole::text end as grantee
     from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     where p.pronamespace = ${nsp} and p.prokind = 'f' and x.grantee <> p.proowner
     order by 1, 2;`),
  Q(`select pubname, tablename from pg_publication_tables where schemaname = ${src} order by 1, 2;`),
  Q(`select x.grantee::regrole::text as grantee, x.privilege_type as priv
     from pg_namespace n, aclexplode(n.nspacl) x
     where n.nspname = ${src} and x.grantee <> n.nspowner;`),
]);

const D = (name) => `${DEV_SCHEMA}.${ident(name)}`;
const sql = [];
const push = (s) => sql.push(s.trim().replace(/;?$/, ';'));

push('begin');
push('set local check_function_bodies = off');
// Loads pg_trgm into this session so its parameters exist: `suggest_items_fuzzy` sets
// `pg_trgm.word_similarity_threshold`, and setting an unloaded module's parameter is refused.
push(`select extensions.similarity('a', 'a')`);
push(`drop schema if exists ${DEV_SCHEMA} cascade`);
push(`create schema ${DEV_SCHEMA}`);
push(`comment on schema ${DEV_SCHEMA} is 'Dev sandbox: structural clone of cardtrade with test data only. Rebuilt by scripts/dev/resetDevSchema.mjs.'`);
for (const { grantee, priv } of schemaAcl) push(`grant ${priv} on schema ${DEV_SCHEMA} to ${grantee}`);
// Mirrors cardtrade's own default privileges, so a migration later applied to the
// sandbox with scripts/dev/applyToDev.mjs gets the same grants it would in production.
push(`alter default privileges in schema ${DEV_SCHEMA} grant select on tables to authenticated`);
push(`alter default privileges in schema ${DEV_SCHEMA} grant select, insert, update, delete on tables to service_role`);

for (const e of enums) {
  push(`create type ${D(e.name)} as enum (${e.labels.map(literal).join(', ')})`);
}
for (const s of sequences) {
  push(
    `create sequence ${D(s.name)} as ${s.type} increment by ${s.increment_by} minvalue ${s.min_value} ` +
      `maxvalue ${s.max_value} start with ${s.start_value} cache ${s.cache_size}${s.cycle ? ' cycle' : ''}`,
  );
}

const byTable = new Map();
for (const c of columns) {
  if (!byTable.has(c.tbl)) byTable.set(c.tbl, []);
  byTable.get(c.tbl).push(c);
}
for (const t of tables) {
  const cols = byTable.get(t.name).map((c) => {
    let def = `${ident(c.col)} ${toDev(c.type)}`;
    if (c.collation) def += ` collate ${c.collation}`;
    if (c.generated === 's') def += ` generated always as (${toDev(c.expr)}) stored`;
    else if (c.expr != null) def += ` default ${toDev(c.expr)}`;
    if (c.notnull) def += ' not null';
    return def;
  });
  push(`create table ${D(t.name)} (\n  ${cols.join(',\n  ')}\n)`);
}
for (const s of sequences.filter((s) => s.owned_by)) {
  const [tbl, col] = s.owned_by.split('.');
  push(`alter sequence ${D(s.name)} owned by ${D(tbl)}.${ident(col)}`);
}
// Functions before constraints and indexes: expression indexes call them (e.g.
// `normalize_tracking`). Their bodies are not checked at creation, so the views and
// tables they query only need to exist by the time they run.
for (const f of functions) push(toDev(f.def));

for (const k of constraints) {
  push(`alter table ${D(k.tbl)} add constraint ${ident(k.name)} ${toDev(k.def)}`);
}
for (const i of indexes) push(toDev(i.def));

// Views in dependency order: one that names another view comes after it.
const viewNames = new Set(views.map((v) => v.name));
const ordered = [];
const visit = (v, seen = new Set()) => {
  if (ordered.includes(v) || seen.has(v.name)) return;
  seen.add(v.name);
  for (const other of views) {
    if (other !== v && viewNames.has(other.name) && new RegExp(`cardtrade\\.${other.name}\\b`).test(v.def)) {
      visit(other, seen);
    }
  }
  ordered.push(v);
};
views.forEach((v) => visit(v));
for (const v of ordered) {
  const options = v.options ? ` with (${v.options})` : '';
  push(`create view ${D(v.name)}${options} as\n${toDev(v.def).replace(/;\s*$/, '')}`);
}

for (const tr of triggers) {
  push(toDev(tr.def));
  const mode = { D: 'disable', R: 'enable replica', A: 'enable always' }[tr.enabled];
  if (mode) push(`alter table ${D(tr.tbl)} ${mode} trigger ${ident(tr.name)}`);
}

for (const t of tables) {
  if (t.rls) push(`alter table ${D(t.name)} enable row level security`);
  if (t.force_rls) push(`alter table ${D(t.name)} force row level security`);
  if (t.replident === 'f') push(`alter table ${D(t.name)} replica identity full`);
}
const CMD = { r: 'select', a: 'insert', w: 'update', d: 'delete', '*': 'all' };
for (const p of policies) {
  let stmt = `create policy ${ident(p.name)} on ${D(p.tbl)} as ${p.permissive ? 'permissive' : 'restrictive'} for ${CMD[p.cmd]} to ${p.roles.join(', ')}`;
  if (p.qual != null) stmt += ` using (${toDev(p.qual)})`;
  if (p.check != null) stmt += ` with check (${toDev(p.check)})`;
  push(stmt);
}

// Grants: start from nothing, then replay production's exact ACLs.
const MEMBER_ROLES = 'public, anon, authenticated, service_role';
for (const t of tables) push(`revoke all on table ${D(t.name)} from ${MEMBER_ROLES}`);
for (const v of views) push(`revoke all on table ${D(v.name)} from ${MEMBER_ROLES}`);
for (const s of sequences) push(`revoke all on sequence ${D(s.name)} from ${MEMBER_ROLES}`);
for (const a of relAcls) {
  const kind = a.kind === 'S' ? 'sequence' : 'table';
  push(`grant ${a.priv} on ${kind} ${D(a.name)} to ${a.grantee}${a.grantable ? ' with grant option' : ''}`);
}
for (const a of colAcls) {
  push(`grant ${a.priv} (${ident(a.col)}) on table ${D(a.name)} to ${a.grantee}`);
}
const allSigs = await Q(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
  from pg_proc p where p.pronamespace = ${nsp} and p.prokind = 'f';`);
for (const { sig } of allSigs) push(`revoke all on function ${DEV_SCHEMA}.${toDev(sig)} from ${MEMBER_ROLES}`);
for (const a of fnAcls) push(`grant execute on function ${DEV_SCHEMA}.${toDev(a.sig)} to ${a.grantee}`);

for (const { pubname, tablename } of publication) {
  push(`alter publication ${ident(pubname)} add table ${D(tablename)}`);
}

for (const table of REFERENCE_TABLES) {
  const cols = (byTable.get(table) ?? []).filter((c) => !c.generated).map((c) => ident(c.col));
  if (cols.length === 0) continue;
  const list = cols.join(', ');
  push(`insert into ${D(table)} (${list}) select ${list} from ${SOURCE_SCHEMA}.${ident(table)}`);
}
for (const s of sequences.filter((s) => s.owned_by)) {
  const [tbl, col] = s.owned_by.split('.');
  push(
    `select setval('${DEV_SCHEMA}.${s.name}', coalesce((select max(${ident(col)}) from ${D(tbl)}), 0) + 1, false)`,
  );
}
push('commit');

const script = sql.join('\n\n');
const file = path.join(tmpdir(), 'cardtrade_dev-clone.sql');
writeFileSync(file, script);
console.log(`Generated ${sql.length} statements (${Math.round(script.length / 1024)} KB): ${file}`);

await query(env, script);
console.log(`Cloned ${SOURCE_SCHEMA} -> ${DEV_SCHEMA}.`);

// PostgREST serves only the schemas it is told to. Adding one is additive and leaves
// the production schema list as it was.
const api = `https://api.supabase.com/v1/projects/${projectRef(env)}/postgrest`;
const headers = { Authorization: `Bearer ${env.SUPABASE_PAT}`, 'Content-Type': 'application/json' };
const pg = await (await fetch(api, { headers })).json();
const exposed = String(pg.db_schema ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!exposed.includes(DEV_SCHEMA)) {
  const next = [...exposed, DEV_SCHEMA].join(',');
  const res = await fetch(api, { method: 'PATCH', headers, body: JSON.stringify({ db_schema: next }) });
  if (!res.ok) throw new Error(`Could not expose ${DEV_SCHEMA} to the API: ${res.status} ${await res.text()}`);
  console.log(`Exposed ${DEV_SCHEMA} to the Data API (${next}).`);
}

// Reload PostgREST's schema cache so the new objects are visible at once.
await query(env, `notify pgrst, 'reload schema';`);

if (withSeed) await seed();

const [check] = await query(
  env,
  `select ${[
    ["'tables'", "relkind = 'r'"],
    ["'views'", "relkind = 'v'"],
    ["'indexes'", "relkind = 'i'"],
  ]
    .map(
      ([label, cond]) =>
        `(select count(*) from pg_class where relnamespace = '${SOURCE_SCHEMA}'::regnamespace and ${cond})::text || '/' || (select count(*) from pg_class where relnamespace = '${DEV_SCHEMA}'::regnamespace and ${cond})::text as ${label.slice(1, -1)}`,
    )
    .join(', ')} ,
   (select count(*) from pg_proc where pronamespace = '${SOURCE_SCHEMA}'::regnamespace)::text || '/' || (select count(*) from pg_proc where pronamespace = '${DEV_SCHEMA}'::regnamespace)::text as functions,
   (select count(*) from pg_policies where schemaname = '${SOURCE_SCHEMA}')::text || '/' || (select count(*) from pg_policies where schemaname = '${DEV_SCHEMA}')::text as policies,
   (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = '${SOURCE_SCHEMA}'::regnamespace and not t.tgisinternal)::text || '/' || (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = '${DEV_SCHEMA}'::regnamespace and not t.tgisinternal)::text as triggers,
   (select count(*) from pg_publication_tables where schemaname = '${SOURCE_SCHEMA}')::text || '/' || (select count(*) from pg_publication_tables where schemaname = '${DEV_SCHEMA}')::text as realtime;`,
);
console.log('production/dev object counts:', check);

/** Load supabase/seed.sql into the sandbox, with sandbox accounts and a private password. */
async function seed() {
  const password = env.E2E_SEED_PASSWORD;
  if (!password || password.length < 16) {
    throw new Error('Set E2E_SEED_PASSWORD (16+ characters) in .env.local before seeding.');
  }
  let text = readFileSync('supabase/seed.sql', 'utf8');
  const ids = [
    ...new Set(
      [...text.matchAll(/'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',\s*'authenticated'/g)].map(
        (m) => m[1],
      ),
    ),
  ];
  text = toDev(text)
    .replace(/set search_path to cardtrade,/g, `set search_path to ${DEV_SCHEMA},`)
    .replaceAll("crypt('password123'", `crypt(${literal(password)}`)
    .replaceAll(
      `'{"provider":"email","providers":["email"]}'`,
      `'{"provider":"email","providers":["email"],"sandbox":true}'`,
    );
  if (/\bcardtrade\./.test(text.replace(/cardtrade_dev\./g, ''))) {
    throw new Error('seed.sql still names the production schema after renaming; refusing to run it.');
  }
  // `on conflict do nothing` keeps an existing account's old password and metadata, so
  // set both explicitly on every reset.
  const idList = ids.map(literal).join(', ');
  text += `\n\nupdate auth.users
    set encrypted_password = extensions.crypt(${literal(password)}, extensions.gen_salt('bf')),
        raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"sandbox": true}'::jsonb
  where id in (${idList});\n`;
  await query(env, text);
  console.log(`Seeded ${DEV_SCHEMA} (${ids.length} sandbox accounts). Uploading listing photos…`);
  await seedImages(env);
}
