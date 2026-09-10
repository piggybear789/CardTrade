/**
 * bootstrap-region-project.mjs
 *
 * Replays the applied `cardtrade` migration history from one Supabase project
 * into another, so the marketplace can be stood up in a different REGION.
 *
 * Why this exists rather than `supabase db push`:
 *
 *   `supabase/migrations/` in this repo is NOT a replayable history. `0001_schema.sql`
 *   creates `profiles`, `items`, `trades` ... unqualified (i.e. into `public`), and no
 *   file in the directory ever runs `create schema cardtrade`, yet every migration from
 *   0007 onward addresses `cardtrade.*`. The deployed database was built by a different
 *   path than the files on disk, so pushing those files at a virgin project produces a
 *   schema that does not match production and then fails partway through.
 *
 *   The authoritative history is `supabase_migrations.schema_migrations.statements` on
 *   the source project, which holds the exact SQL that was actually applied. This script
 *   replays that, in `version` order, and records each migration on the target so the
 *   target's history matches the source's.
 *
 * Region moves are the whole point: a Supabase project is bound to its region at the
 * infrastructure level, and "Restore to a New Project" deliberately keeps the clone in
 * the source region for data residency. Create-new-and-replay is the only path.
 *
 * Safety properties:
 *   - Read-only against the source. Nothing is written to it.
 *   - Resumable. Migrations already recorded on the target are skipped, so a rerun after
 *     a failure continues rather than reapplying.
 *   - Fail-fast. Order matters, so the first error stops the run and names the migration.
 *   - The access token is read from the environment or the local MCP config and is never
 *     printed, including in error output.
 *
 * The source's recorded history is ALSO incomplete: several migrations (0091, 0094,
 * 0096 ...) were applied by hand through the SQL editor and never recorded, so replaying
 * the record alone fails on the first object they created. `--list-missing` reports the
 * local files that the source never recorded so they can be applied explicitly with
 * `--apply-file`. That list is deliberately NOT applied automatically: it also contains
 * files that must never run against a fresh project (0001-0003 create tables in `public`)
 * and superseded rewrites (0008 exists twice), so a human picks from it.
 *
 * Usage:
 *   node scripts/bootstrap-region-project.mjs --source <ref> --target <ref> \
 *     [--from-version 20260723104106] [--dry-run]
 *   node scripts/bootstrap-region-project.mjs --source <ref> --list-missing
 *   node scripts/bootstrap-region-project.mjs --target <ref> \
 *     --apply-file supabase/migrations/0091_x.sql --apply-file supabase/migrations/0094_y.sql
 */

import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const API = 'https://api.supabase.com';

/** Parse `--flag value` and `--flag=value` argv into a plain object. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    let key;
    let value;
    if (eq !== -1) {
      key = arg.slice(2, eq);
      value = arg.slice(eq + 1);
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      key = arg.slice(2);
      value = argv[i + 1];
      i += 1;
    } else {
      key = arg.slice(2);
      value = true;
    }
    // Repeated flags accumulate, so `--apply-file a --apply-file b` keeps both.
    if (key in out) {
      out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key], value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Resolve a Supabase personal access token.
 *
 * Prefers the environment. Falls back to the locally configured Supabase MCP server,
 * which already holds a token for this account, so that running this script does not
 * require the operator to paste a secret into their shell history.
 */
function resolveAccessToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT;
  if (fromEnv) return fromEnv.trim();

  const candidates = [
    join(homedir(), '.kiro', 'settings', 'mcp.json'),
    join(homedir(), '.cursor', 'mcp.json'),
    join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
  ];

  for (const path of candidates) {
    let raw;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    let config;
    try {
      config = JSON.parse(raw);
    } catch {
      continue;
    }
    const servers = config.mcpServers ?? {};
    for (const server of Object.values(servers)) {
      const env = server?.env ?? {};
      for (const key of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PAT']) {
        const value = env[key];
        // Skip unexpanded placeholders like "${SUPABASE_PAT}".
        if (typeof value === 'string' && value.startsWith('sb')) return value.trim();
      }
      const args = Array.isArray(server?.args) ? server.args : [];
      const flagIndex = args.indexOf('--access-token');
      if (flagIndex !== -1 && typeof args[flagIndex + 1] === 'string') {
        return args[flagIndex + 1].trim();
      }
      const inline = args.find(
        (a) => typeof a === 'string' && a.startsWith('--access-token='),
      );
      if (inline) return inline.split('=')[1].trim();
    }
  }

  throw new Error(
    'No Supabase access token found. Set SUPABASE_ACCESS_TOKEN, or configure the Supabase MCP server.',
  );
}

/**
 * Run SQL against a project via the Management API.
 *
 * Errors are rethrown with the token stripped from any message, so a failure cannot
 * leak the credential into logs.
 */
async function query(token, ref, sql) {
  const res = await fetch(`${API}/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await res.text();
  if (!res.ok) {
    const redacted = text.split(token).join('[redacted]');
    throw new Error(`HTTP ${res.status} on ${ref}: ${redacted.slice(0, 2000)}`);
  }
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

/** Wrap a SQL body in a dollar-quoted literal, choosing a tag the body cannot contain. */
function dollarQuote(body, hint) {
  let tag = `mig_${hint}`;
  let guard = 0;
  while (body.includes(`$${tag}$`)) {
    tag = `mig_${hint}_${(guard += 1)}`;
  }
  return `$${tag}$${body}$${tag}$`;
}

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

/**
 * Structural fingerprint of everything the marketplace owns.
 *
 * Neither migration history in this repo is complete, so the only trustworthy oracle for
 * "does the new project match the old one" is the live catalog. This returns one sorted
 * row per object so two projects can be compared by set difference.
 *
 * Deliberately covers the things a region move silently loses: RLS policies, column
 * grants, triggers, enum labels, storage buckets, cron jobs and realtime publication
 * membership. A schema that matches on tables alone can still be broken on all of those.
 */
const FINGERPRINT_SQL = `
with cols as (
  select 'column   ' || table_name || '.' || column_name || ' ' || data_type ||
         case when is_nullable = 'NO' then ' not-null' else '' end as fp
  from information_schema.columns where table_schema = 'cardtrade'
),
tabs as (
  select 'table    ' || tablename || case when rowsecurity then ' rls' else ' NO-RLS' end as fp
  from pg_tables where schemaname = 'cardtrade'
),
views as (
  select 'view     ' || table_name as fp
  from information_schema.views where table_schema = 'cardtrade'
),
funcs as (
  select 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fp
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'cardtrade'
),
pols as (
  select 'policy   ' || tablename || '.' || policyname || ' ' || cmd as fp
  from pg_policies where schemaname = 'cardtrade'
),
trigs as (
  select 'trigger  ' || c.relname || '.' || t.tgname as fp
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'cardtrade' and not t.tgisinternal
),
idx as (
  select 'index    ' || indexname as fp from pg_indexes where schemaname = 'cardtrade'
),
enums as (
  select 'enum     ' || t.typname || '.' || e.enumlabel as fp
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  join pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'cardtrade'
),
grants as (
  select 'grant    ' || table_name || '.' || coalesce(column_name, '*') || ' ' ||
         privilege_type || ' -> ' || grantee as fp
  from information_schema.column_privileges
  where table_schema = 'cardtrade' and grantee in ('anon', 'authenticated')
  union all
  select 'grant-t  ' || table_name || ' ' || privilege_type || ' -> ' || grantee as fp
  from information_schema.table_privileges
  where table_schema = 'cardtrade' and grantee in ('anon', 'authenticated')
),
buckets as (
  select 'bucket   ' || id || case when public then ' public' else ' private' end as fp
  from storage.buckets
),
storage_pols as (
  select 'stpolicy ' || tablename || '.' || policyname as fp
  from pg_policies where schemaname = 'storage'
),
jobs as (
  select 'cron     ' || jobname || ' @ ' || schedule as fp from cron.job
),
pubs as (
  select 'realtime ' || schemaname || '.' || tablename as fp
  from pg_publication_tables where pubname = 'supabase_realtime'
)
select fp from (
  select fp from cols union all select fp from tabs union all select fp from views
  union all select fp from funcs union all select fp from pols union all select fp from trigs
  union all select fp from idx union all select fp from enums union all select fp from grants
  union all select fp from buckets union all select fp from storage_pols
  union all select fp from jobs union all select fp from pubs
) all_fp
order by fp;
`;

/**
 * Point `.env.local` at a project, fetching its keys from the Management API.
 *
 * Rewrites EVERY occurrence of each key, not the first: `.env.local` declares
 * NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY twice, and both dotenv and
 * `scripts/apply-sql.mjs` take the LAST value, so patching only the first would leave the
 * file pointing at two different projects with the stale one winning.
 *
 * Values are never printed. The previous file is kept as `.env.local.bak`.
 */
async function writeEnv(token, target, envPath = '.env.local') {
  const res = await fetch(`${API}/v1/projects/${target}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Could not read API keys for ${target}: HTTP ${res.status}`);
  }
  const keys = await res.json();

  const pick = (...names) => {
    for (const name of names) {
      const hit = keys.find((k) => k.name === name || k.type === name);
      if (hit?.api_key) return hit.api_key;
    }
    return null;
  };

  const anon = pick('anon', 'publishable');
  const service = pick('service_role', 'secret');
  if (!anon || !service) {
    throw new Error(
      `Expected both an anon/publishable and a service_role/secret key; got ${keys
        .map((k) => k.name ?? k.type)
        .join(', ')}`,
    );
  }

  const original = readFileSync(envPath, 'utf8');
  writeFileSync(`${envPath}.bak`, original, 'utf8');

  const replacements = [
    ['NEXT_PUBLIC_SUPABASE_URL', `https://${target}.supabase.co`],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', anon],
    ['SUPABASE_SERVICE_ROLE_KEY', service],
  ];

  let updated = original;
  const counts = {};
  for (const [key, value] of replacements) {
    const pattern = new RegExp(`^${key}=.*$`, 'gm');
    counts[key] = (updated.match(pattern) ?? []).length;
    updated = updated.replace(pattern, `${key}=${value}`);
  }

  // A key that was never present would otherwise be silently skipped.
  const absent = replacements.filter(([key]) => counts[key] === 0).map(([key]) => key);
  for (const key of absent) {
    const value = replacements.find(([k]) => k === key)[1];
    updated += `\n${key}=${value}\n`;
    counts[key] = 1;
  }

  writeFileSync(envPath, updated, 'utf8');

  console.log(`${envPath} now points at ${target}. Backup: ${envPath}.bak`);
  for (const [key] of replacements) {
    console.log(`  ${key}: ${counts[key]} occurrence(s) written`);
  }
  if (absent.length) console.log(`  (appended, previously absent: ${absent.join(', ')})`);
}

/**
 * Copy the PostgREST exposure settings from source to target.
 *
 * This is NOT schema and no migration carries it. Every Supabase client in this repo is
 * constructed with `db: { schema: 'cardtrade' }`, which means every read and write goes
 * through PostgREST against that schema — and PostgREST only serves schemas listed in the
 * project's exposed-schemas setting. A fresh project lists `public, graphql_public` only,
 * so a byte-perfect schema copy still answers HTTP 406 to every query.
 *
 * `db_extra_search_path` matters for the same reason: functions resolve unqualified names
 * against it, and several `cardtrade` RPCs were written assuming the source's value.
 *
 * DO NOT just copy the source's `db_schema`. The Management API reports
 * `public,graphql_public` for the source even though the source demonstrably serves
 * `cardtrade` over REST — a direct request for the `cardtrade` profile returns 200 there
 * and PGRST106 "Invalid schema" on a fresh project. So the reported value under-states
 * reality, and copying it produces a project that looks configured and answers 406 to
 * every query the app makes. The required schemas are therefore asserted explicitly.
 */
const REQUIRED_EXPOSED_SCHEMAS = ['public', 'graphql_public', 'cardtrade'];

async function syncApiConfig(token, source, target) {
  const read = async (ref) => {
    const res = await fetch(`${API}/v1/projects/${ref}/postgrest`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Could not read PostgREST config for ${ref}: HTTP ${res.status}`);
    return res.json();
  };

  const src = await read(source);
  const tgt = await read(target);

  console.log('source db_schema           :', src.db_schema);
  console.log('target db_schema (before)  :', tgt.db_schema);
  console.log('source db_extra_search_path:', src.db_extra_search_path);
  console.log('target db_extra_search_path:', tgt.db_extra_search_path);
  console.log('source max_rows            :', src.max_rows);

  // Union of what the source reports and what the app actually needs.
  const exposed = [
    ...new Set([
      ...String(src.db_schema ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      ...REQUIRED_EXPOSED_SCHEMAS,
    ]),
  ];

  const body = {
    db_schema: exposed.join(','),
    db_extra_search_path: src.db_extra_search_path,
    max_rows: src.max_rows,
  };

  console.log('target db_schema (writing) :', body.db_schema);

  const res = await fetch(`${API}/v1/projects/${target}/postgrest`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH postgrest failed: HTTP ${res.status} ${text.slice(0, 500)}`);
  }

  const after = await read(target);
  console.log('target db_schema (after)    :', after.db_schema);

  const missing = REQUIRED_EXPOSED_SCHEMAS.filter(
    (s) =>
      !String(after.db_schema ?? '')
        .split(',')
        .map((x) => x.trim())
        .includes(s),
  );
  console.log(
    missing.length === 0
      ? 'OK — every schema the app queries is exposed.'
      : `STILL MISSING: ${missing.join(', ')} — the app will get HTTP 406.`,
  );
}

/**
 * Auth settings that must follow the project, and why each one matters.
 *
 * None of these live in a migration, so a byte-perfect schema copy still ships an
 * unusable auth setup. Observed on this move: Google OAuth enabled on the source and
 * disabled on the target, `uri_allow_list` empty (which refuses every OAuth and
 * magic-link redirect), `site_url` pointing at localhost so password-reset emails link
 * to the developer's machine, and `mailer_autoconfirm` flipped, which silently changes
 * whether sign-up requires an email round trip.
 *
 * Deliberately NOT copied: SMTP credentials and JWT secrets (per-project by design),
 * and `custom_oauth_max_providers` (a plan limit, not a setting).
 */
const AUTH_KEYS_TO_SYNC = [
  'site_url',
  'uri_allow_list',
  'mailer_autoconfirm',
  'mailer_otp_length',
  'smtp_max_frequency',
  'password_required_characters',
  'password_min_length',
  'mfa_totp_enroll_enabled',
  'mfa_totp_verify_enabled',
  'external_google_enabled',
  'external_google_client_id',
  'external_google_secret',
  'external_google_skip_nonce_check',
];

/** Copy the load-bearing auth settings from source to target. */
async function syncAuthConfig(token, source, target) {
  const read = async (ref) => {
    const res = await fetch(`${API}/v1/projects/${ref}/config/auth`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Could not read auth config for ${ref}: HTTP ${res.status}`);
    return res.json();
  };

  const src = await read(source);
  const body = {};

  for (const key of AUTH_KEYS_TO_SYNC) {
    const value = src[key];
    if (value === undefined || value === null) continue;
    body[key] = value;
  }

  // The API may withhold or mask a provider secret. Google is configured in .env.local
  // for the app itself, so fall back to that rather than silently enabling a provider
  // with no usable secret — which fails only at the moment a member clicks the button.
  const looksMasked =
    typeof body.external_google_secret !== 'string' ||
    body.external_google_secret.length === 0 ||
    /^\**$/.test(body.external_google_secret);

  if (body.external_google_enabled && looksMasked) {
    let fallback = null;
    try {
      const envText = readFileSync('.env.local', 'utf8');
      const m = /^CLIENT_SECRET\s*=\s*(.*)$/m.exec(envText);
      if (m) fallback = m[1].trim().replace(/^["']|["']$/g, '');
    } catch {
      // no .env.local; handled below
    }
    if (fallback) {
      body.external_google_secret = fallback;
      console.log('external_google_secret: taken from .env.local CLIENT_SECRET');
    } else {
      delete body.external_google_enabled;
      delete body.external_google_client_id;
      delete body.external_google_secret;
      console.log(
        'external_google_*: SKIPPED — no usable secret. Enable Google in the dashboard.',
      );
    }
  }

  const res = await fetch(`${API}/v1/projects/${target}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `PATCH auth config failed: HTTP ${res.status} ${(await res.text()).slice(0, 600)}`,
    );
  }

  const after = await read(target);
  const secretish = /secret/i;
  let mismatched = 0;
  for (const key of Object.keys(body)) {
    const want = body[key];
    const got = after[key];
    const ok = JSON.stringify(want) === JSON.stringify(got);
    if (!ok) mismatched += 1;
    const shown = secretish.test(key) ? '(withheld)' : JSON.stringify(got);
    console.log(`  ${ok ? 'ok  ' : 'DIFF'} ${key} = ${shown}`);
  }
  console.log(
    mismatched === 0
      ? '\nAll synced auth settings match the source.'
      : `\n${mismatched} setting(s) did not take — check the dashboard.`,
  );
}

/** Compare two projects structurally and print only the differences. */
async function diffProjects(token, source, target) {
  const [srcRows, tgtRows] = await Promise.all([
    query(token, source, FINGERPRINT_SQL),
    query(token, target, FINGERPRINT_SQL),
  ]);

  const src = new Set((srcRows ?? []).map((r) => r.fp));
  const tgt = new Set((tgtRows ?? []).map((r) => r.fp));

  const missing = [...src].filter((fp) => !tgt.has(fp)).sort();
  const extra = [...tgt].filter((fp) => !src.has(fp)).sort();

  console.log(`source objects: ${src.size}`);
  console.log(`target objects: ${tgt.size}\n`);

  if (missing.length === 0 && extra.length === 0) {
    console.log('IDENTICAL — no structural differences.');
    return true;
  }

  if (missing.length) {
    console.log(`MISSING on target (${missing.length}):`);
    for (const fp of missing) console.log(`  - ${fp}`);
  }
  if (extra.length) {
    console.log(`\nEXTRA on target (${extra.length}):`);
    for (const fp of extra) console.log(`  + ${fp}`);
  }
  return false;
}

/** Local migration files as `{ file, prefix, slug }`, ordered by filename. */
function localMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const stem = file.replace(/\.sql$/, '');
      const match = stem.match(/^(\d+)_(.+)$/);
      return {
        file,
        prefix: match ? match[1] : '',
        slug: match ? match[2] : stem,
      };
    });
}

/** Recorded migration names carry an inconsistent numeric prefix; strip it to compare. */
function normaliseSlug(name) {
  return name
    .replace(/^\d+_/, '')
    .replace(/^cardtrade_/, '')
    .toLowerCase();
}

/**
 * Report local migration files that the source never recorded.
 *
 * These are the out-of-band edits. The list needs human curation before use, so this
 * only prints.
 */
async function listMissing(token, source) {
  const rows = await query(
    token,
    source,
    'select coalesce(name, \'\') as name from supabase_migrations.schema_migrations;',
  );
  const recorded = new Set((rows ?? []).map((r) => normaliseSlug(r.name)));

  const missing = localMigrations().filter((m) => !recorded.has(normaliseSlug(m.slug)));

  console.log(`${missing.length} local file(s) absent from the source's recorded history:\n`);
  for (const m of missing) console.log(`  supabase/migrations/${m.file}`);
  console.log(
    '\nCurate before applying. Files that create unqualified tables, or that were',
  );
  console.log('superseded by a later rewrite, must NOT be applied to a fresh project.');
}

/**
 * Append to a progress log on disk.
 *
 * Console output from this script has proven unreliable to capture through the shell
 * wrapper used to drive it, and losing the record of which migration failed is the one
 * thing that makes a partial replay dangerous. So progress is written to a file directly.
 */
function logLine(text) {
  console.log(text);
  try {
    appendFileSync(join(process.cwd(), '.tmp-bootstrap.log'), `${text}\n`);
  } catch {
    // Logging must never be the reason a replay fails.
  }
}

/**
 * Apply explicit local migration files, in the order given, recording each.
 *
 * Resumable: a file whose version is already recorded on the target is skipped, so this
 * can be invoked repeatedly until it completes without reapplying earlier work.
 */
async function applyFiles(token, target, files, dryRun) {
  const recordedRows = dryRun
    ? []
    : await query(token, target, 'select version from supabase_migrations.schema_migrations;');
  const recorded = new Set((recordedRows ?? []).map((r) => r.version));

  let applied = 0;
  let skipped = 0;

  for (const rel of files) {
    const body = readFileSync(join(process.cwd(), rel), 'utf8');
    const stem = basename(rel).replace(/\.sql$/, '');
    const match = stem.match(/^(\d+a?)_(.+)$/);
    const version = match ? match[1] : stem;
    const name = match ? match[2] : stem;

    if (dryRun) {
      logLine(`would apply  ${rel}`);
      continue;
    }
    if (recorded.has(version)) {
      skipped += 1;
      continue;
    }
    try {
      await query(token, target, body);
      await query(
        token,
        target,
        `insert into supabase_migrations.schema_migrations (version, name, statements)
         values (
           ${dollarQuote(version, 'v')},
           ${dollarQuote(name, 'n')},
           array[${dollarQuote(body, version)}]::text[]
         )
         on conflict (version) do nothing;`,
      );
      applied += 1;
      logLine(`applied      ${rel}`);
    } catch (err) {
      logLine(`FAILED       ${rel}`);
      logLine(`             ${String(err.message ?? err).split('\n').join(' ')}`);
      process.exit(1);
    }
  }
  logLine(
    `${dryRun ? 'Dry run complete' : 'Done'}: ${applied} applied, ${skipped} already recorded.`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = args.source;
  const target = args.target;
  const fromVersion = args['from-version'] ?? '';
  const dryRun = Boolean(args['dry-run']);

  if (args['list-missing']) {
    if (!source) throw new Error('--list-missing requires --source <ref>.');
    await listMissing(resolveAccessToken(), source);
    return;
  }

  if (args.diff) {
    if (!source || !target) throw new Error('--diff requires --source and --target.');
    const identical = await diffProjects(resolveAccessToken(), source, target);
    process.exit(identical ? 0 : 1);
  }

  if (args['write-env']) {
    if (!target) throw new Error('--write-env requires --target <ref>.');
    await writeEnv(resolveAccessToken(), target);
    return;
  }

  if (args['sync-config']) {
    if (!source || !target) throw new Error('--sync-config requires --source and --target.');
    await syncApiConfig(resolveAccessToken(), source, target);
    return;
  }

  if (args['sync-auth']) {
    if (!source || !target) throw new Error('--sync-auth requires --source and --target.');
    await syncAuthConfig(resolveAccessToken(), source, target);
    return;
  }

  if (args['apply-file']) {
    if (!target) throw new Error('--apply-file requires --target <ref>.');
    const files = Array.isArray(args['apply-file'])
      ? args['apply-file']
      : String(args['apply-file']).split(',');
    await applyFiles(resolveAccessToken(), target, files, dryRun);
    return;
  }

  if (!source || !target) {
    throw new Error(
      'Both --source <ref> and --target <ref> are required.',
    );
  }
  if (source === target) {
    throw new Error('--source and --target must differ.');
  }

  const token = resolveAccessToken();

  console.log(`source : ${source} (read-only)`);
  console.log(`target : ${target}`);
  console.log(`from   : ${fromVersion || '(beginning of history)'}`);
  console.log(dryRun ? 'mode   : DRY RUN\n' : 'mode   : APPLY\n');

  // The target needs somewhere to record history before anything is replayed.
  // Column shape mirrors the source so later CLI/MCP writes find what they expect.
  if (!dryRun) {
    await query(
      token,
      target,
      `create schema if not exists supabase_migrations;
       create table if not exists supabase_migrations.schema_migrations (
         version text not null primary key,
         statements text[],
         name text,
         created_by text,
         idempotency_key text,
         rollback text[]
       );`,
    );
  }

  const pending = await query(
    token,
    source,
    `select version, coalesce(name, '') as name, array_to_string(statements, E'\\n') as body
       from supabase_migrations.schema_migrations
      where version >= '${fromVersion.replace(/'/g, "''")}'
      order by version asc;`,
  );

  if (!Array.isArray(pending) || pending.length === 0) {
    throw new Error('Source returned no migrations. Refusing to continue.');
  }

  const appliedRows = dryRun
    ? []
    : await query(
        token,
        target,
        'select version from supabase_migrations.schema_migrations;',
      );
  const applied = new Set((appliedRows ?? []).map((r) => r.version));

  console.log(`${pending.length} migrations in scope, ${applied.size} already on target\n`);

  let ran = 0;
  let skipped = 0;

  for (const row of pending) {
    const label = `${row.version} ${row.name}`.trim();

    if (applied.has(row.version)) {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      console.log(`would apply  ${label}`);
      ran += 1;
      continue;
    }

    try {
      await query(token, target, row.body);
      await query(
        token,
        target,
        `insert into supabase_migrations.schema_migrations (version, name, statements)
         values (
           ${dollarQuote(row.version, 'v')},
           ${dollarQuote(row.name, 'n')},
           array[${dollarQuote(row.body, row.version)}]::text[]
         )
         on conflict (version) do nothing;`,
      );
      ran += 1;
      logLine(`applied      ${label}`);
    } catch (err) {
      logLine(`FAILED       ${label}`);
      logLine(`             ${String(err.message ?? err).split('\n').join(' ')}`);
      logLine('Stopped. Order matters, so nothing after this was attempted.');
      process.exit(1);
    }
  }

  logLine(
    `${dryRun ? 'Dry run complete' : 'Replay complete'}: ${ran} applied, ${skipped} skipped.`,
  );
}

main().catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(1);
});
