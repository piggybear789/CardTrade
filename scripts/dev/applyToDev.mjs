// scripts/dev/applyToDev.mjs
//
// Apply a migration to the dev sandbox (`cardtrade_dev`) instead of production, by
// renaming the schema the same way the clone does (`toDev` in ./lib.mjs).
//
//   npm run dev:db:apply -- supabase/migrations/0180_something.sql
//
// The way to try a migration before it reaches production. After it ships to
// `cardtrade`, `npm run dev:db:reset` re-clones from production anyway.
//
// REFUSES a file that writes to what the two schemas SHARE: pg_cron jobs, Storage
// buckets and policies, and `auth`. Renaming cannot sandbox those, so applying it
// here would change production. Apply such a migration to production on purpose.
import { readFileSync } from 'node:fs';
import { DEV_SCHEMA, loadEnv, query, toDev } from './lib.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run dev:db:apply -- <migration.sql>');
  process.exit(1);
}

const original = readFileSync(file, 'utf8');
// Comments may mention anything; only statements matter.
const code = original.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const shared = [
  [/\bcron\.(schedule|unschedule|alter_job)\b/i, 'pg_cron jobs'],
  [/\b(insert\s+into|update|delete\s+from)\s+storage\./i, 'Storage rows'],
  [/\bon\s+storage\.objects\b/i, 'Storage policies'],
  [/\b(alter|create|drop|insert\s+into|update|delete\s+from)\s+(table\s+|trigger\s+\w+\s+\w+\s+\w+\s+on\s+)?auth\./i, 'the auth schema'],
];
const hits = shared.filter(([re]) => re.test(code)).map(([, what]) => what);
if (hits.length > 0) {
  console.error(`Refusing: ${file} writes to ${hits.join(', ')}, which the dev schema shares with production.`);
  process.exit(1);
}

const sql = toDev(original);
if (/(?<![A-Za-z0-9_$"])cardtrade\./.test(sql)) {
  throw new Error('Renaming left a reference to the production schema; refusing to run it.');
}

const env = loadEnv();
await query(env, `begin;\nset local search_path = ${DEV_SCHEMA}, extensions, public;\n${sql}\n;\ncommit;`);
await query(env, `notify pgrst, 'reload schema';`);
console.log(`Applied ${file} to ${DEV_SCHEMA}.`);
