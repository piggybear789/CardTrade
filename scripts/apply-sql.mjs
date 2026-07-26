// scripts/apply-sql.mjs
//
// Run a .sql file (or inline SQL on stdin) against the linked Supabase project
// using the Management API, which is the only channel available here — there is
// no local Postgres and no `exec_sql` RPC in the `cardtrade` schema.
//
// Credentials come from .env.local (SUPABASE_PAT + NEXT_PUBLIC_SUPABASE_URL);
// nothing is echoed back, only the query result rows.
//
// Usage:
//   node scripts/apply-sql.mjs supabase/seed_marketplace.sql
//   echo "select count(*) from cardtrade.items" | node scripts/apply-sql.mjs -

import { readFileSync } from 'node:fs';

/** Parse KEY=VALUE lines from .env.local; later duplicates win (dotenv-style last-wins is fine here). */
function loadEnv(path = '.env.local') {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = loadEnv();
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const pat = env.SUPABASE_PAT;
if (!pat) {
  console.error('SUPABASE_PAT missing from .env.local');
  process.exit(1);
}

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/apply-sql.mjs <file.sql | ->');
  process.exit(1);
}
const query = target === '-' ? readFileSync(0, 'utf8') : readFileSync(target, 'utf8');

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});

const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  console.error(text);
  process.exit(1);
}
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
