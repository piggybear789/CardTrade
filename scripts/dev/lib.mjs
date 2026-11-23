// scripts/dev/lib.mjs
//
// Shared plumbing for the dev-sandbox scripts: .env.local, the Management API query
// endpoint, and the ONE rename rule that turns production DDL into sandbox DDL.
import { readFileSync } from 'node:fs';

export const SOURCE_SCHEMA = 'cardtrade';
export const DEV_SCHEMA = 'cardtrade_dev';

/** KEY=VALUE lines from .env.local (last one wins). Real env vars take precedence. */
export function loadEnv(path = '.env.local') {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { ...out, ...process.env };
}

export function projectRef(env) {
  return new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
}

/** Run SQL through the Management API (runs as `postgres`). Returns the last result set. */
export async function query(env, sql) {
  if (!env.SUPABASE_PAT) throw new Error('SUPABASE_PAT missing from .env.local');
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef(env)}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`query failed (${res.status}): ${text.slice(0, 2000)}`);
  return text ? JSON.parse(text) : [];
}

/**
 * Production DDL -> sandbox DDL. Catalog output is read with an empty search_path, so
 * every object is schema-qualified (`cardtrade.items`, `cardtrade.trade_state`), and
 * functions name their search_path as the quoted literal `'cardtrade'`. Names that
 * merely START with the word (`cardtrade_auto_complete_cash_sales`, `cardtrade_trade_id`
 * metadata keys) are untouched: the match needs a dot or a closing quote after it.
 */
export function toDev(sql) {
  return sql
    .replace(/(?<![A-Za-z0-9_$"])cardtrade\./g, `${DEV_SCHEMA}.`)
    .replace(/"cardtrade"\./g, `"${DEV_SCHEMA}".`)
    .replace(/'cardtrade'/g, `'${DEV_SCHEMA}'`);
}

export function ident(name) {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

export function literal(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
