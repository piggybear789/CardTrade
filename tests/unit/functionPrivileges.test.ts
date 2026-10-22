// tests/unit/functionPrivileges.test.ts
//
// No SECURITY DEFINER function in `cardtrade` is callable by members unless it is on
// the allow-list below (ESC-39, replacing what 0147 meant to do).
//
// Postgres grants EXECUTE on every new function to PUBLIC, and `cardtrade` is exposed
// through PostgREST. A definer function runs as its owner and skips RLS, so one whose
// migration forgets `revoke ... from public, anon, authenticated` is an endpoint anyone
// with the anon key can call. Migration 0147 tried to turn the default off for the
// schema, but a schema-scoped default can only ADD privileges and cannot remove the
// global PUBLIC grant: a function created after it was still callable by anon (probed
// on the live database, 2026-10-22). So this test replays every migration's GRANT,
// REVOKE, CREATE and DROP (`scripts/lib/functionPrivileges.ts`) and fails on any
// exposure nobody decided on.
//
// When it fails: add the revoke to the migration that creates the function (and grant
// `service_role` if the server calls it). Only add to the allow-list for a function
// members are MEANT to call, and say why beside it.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  canExecute,
  functionPrivilegesAfter,
  splitStatements,
  type MigrationSource,
} from '../../scripts/lib/functionPrivileges';

/** Definer functions members may call, and which roles may. */
const ALLOWED: Record<string, { anon: boolean; authenticated: boolean; why: string }> = {
  'is_staff/0': {
    anon: true,
    authenticated: true,
    why: 'RLS helper: answers whether the CALLER is staff, so it reveals nothing about anyone else.',
  },
  'is_fraud_banned/0': {
    anon: false,
    authenticated: true,
    why: "Reports the caller's own ban, for the sign-in and proxy redirect.",
  },
  'member_sale_stats/1': {
    anon: false,
    authenticated: true,
    why: 'Public sale counts shown on a seller profile; returns aggregates only.',
  },
};

/**
 * Created before the migration history began, so no migration defines it and this test
 * cannot see it. It is an RLS helper like `is_staff`. Noted so a reader of the live
 * database finds it accounted for.
 */
const OUT_OF_BAND = ['is_admin/0'];

function migrations(): MigrationSource[] {
  const dir = join(process.cwd(), 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

/** Replay hand-written migrations, one SQL string each. */
function replay(...sql: string[]) {
  return functionPrivilegesAfter(sql.map((text, i) => ({ name: `000${i}_test.sql`, sql: text })));
}

const DEFINER = (name: string, args = '') =>
  `create or replace function cardtrade.${name}(${args}) returns int language sql security definer as $$ select 1 $$;`;

describe('the privilege model follows Postgres', () => {
  it('grants PUBLIC on a new function, which a revoke removes', () => {
    const open = replay(DEFINER('f')).get('f/0')!;
    expect(canExecute(open, 'anon')).toBe(true);
    expect(canExecute(open, 'authenticated')).toBe(true);

    const closed = replay(DEFINER('f'), 'revoke all on function cardtrade.f() from public, anon, authenticated;').get('f/0')!;
    expect(canExecute(closed, 'anon')).toBe(false);
    expect(canExecute(closed, 'authenticated')).toBe(false);
  });

  it('keeps the privileges across CREATE OR REPLACE, and resets them after a DROP', () => {
    const revoked = 'revoke execute on function cardtrade.f() from public;';
    expect(canExecute(replay(DEFINER('f'), revoked, DEFINER('f')).get('f/0')!, 'anon')).toBe(false);
    expect(
      canExecute(replay(DEFINER('f'), revoked, 'drop function if exists cardtrade.f();', DEFINER('f')).get('f/0')!, 'anon'),
    ).toBe(true);
  });

  it('treats a new signature as a new function with its own privileges', () => {
    const fns = replay(
      DEFINER('f', 'a int'),
      'revoke all on function cardtrade.f(int) from public;',
      DEFINER('f', 'a int, b text default null'),
    );
    expect(canExecute(fns.get('f/1')!, 'anon')).toBe(false);
    expect(canExecute(fns.get('f/2')!, 'anon')).toBe(true);
  });

  it('does NOT treat a schema-scoped default revoke as working (the 0147 mistake)', () => {
    const fns = replay(
      'alter default privileges for role postgres in schema cardtrade revoke execute on functions from public, anon, authenticated;',
      DEFINER('f'),
    );
    expect(canExecute(fns.get('f/0')!, 'anon')).toBe(true);
    // A GLOBAL default revoke does change the default.
    const global = replay('alter default privileges for role postgres revoke execute on functions from public;', DEFINER('f'));
    expect(canExecute(global.get('f/0')!, 'anon')).toBe(false);
  });

  it('applies grants and revokes on all functions in the schema', () => {
    const fns = replay(DEFINER('f'), DEFINER('g'), 'revoke execute on all functions in schema cardtrade from public;');
    expect(canExecute(fns.get('f/0')!, 'anon')).toBe(false);
    expect(canExecute(fns.get('g/0')!, 'anon')).toBe(false);
  });

  it('reads security definer wherever it is written, and never from a body or a comment', () => {
    const after = replay(
      'create function cardtrade.f() returns int as $fn$ select 1; $fn$ language sql security definer;',
    ).get('f/0')!;
    expect(after.securityDefiner).toBe(true);
    const inBody = replay(
      "-- security definer\ncreate function cardtrade.f() returns text language sql as $$ select 'security definer; drop' $$;",
    ).get('f/0')!;
    expect(inBody.securityDefiner).toBe(false);
  });

  it('marks trigger functions, which cannot be called as an RPC', () => {
    const fn = replay(
      'create function cardtrade.t() returns trigger language plpgsql security definer as $$ begin return new; end $$;',
    ).get('t/0')!;
    expect(fn.returnsTrigger).toBe(true);
  });

  it('throws on a revoke it cannot match rather than passing vacuously', () => {
    expect(() => replay('revoke all on function cardtrade.missing() from public;')).toThrow(/unknown function/);
  });

  it('splits on top-level semicolons only', () => {
    expect(splitStatements("select ';'; create function x() returns int as $$ select 1; $$; grant x")).toHaveLength(3);
  });
});

describe('cardtrade definer functions callable by members', () => {
  const fns = functionPrivilegesAfter(migrations());

  it('reads every migration and finds the functions (not a vacuous pass)', () => {
    const all = [...fns.values()];
    expect(all.length).toBeGreaterThan(80);
    expect(all.filter((fn) => fn.securityDefiner).length).toBeGreaterThan(40);
  });

  it('exposes nothing beyond the allow-list', () => {
    const exposed = [...fns.values()]
      .filter((fn) => fn.securityDefiner && !fn.returnsTrigger)
      .filter((fn) => canExecute(fn, 'anon') || canExecute(fn, 'authenticated'))
      .map((fn) => ({
        key: fn.key,
        anon: canExecute(fn, 'anon'),
        authenticated: canExecute(fn, 'authenticated'),
        createdIn: fn.createdIn,
      }));
    for (const fn of exposed) {
      const allowed = ALLOWED[fn.key];
      expect(allowed, `${fn.key} (${fn.createdIn}) is SECURITY DEFINER and callable by members; revoke it`).toBeDefined();
      if (!allowed) continue;
      expect(fn.anon, `${fn.key} is callable by anon`).toBe(allowed.anon);
      expect(fn.authenticated, `${fn.key} is callable by authenticated`).toBe(allowed.authenticated);
    }
  });

  it('keeps the allow-list honest: every entry still exists as a definer function', () => {
    for (const key of Object.keys(ALLOWED)) {
      const fn = fns.get(key);
      expect(fn, `${key} is on the allow-list but no migration creates it`).toBeDefined();
      expect(fn?.securityDefiner, `${key} is no longer SECURITY DEFINER; drop it from the allow-list`).toBe(true);
    }
    for (const key of OUT_OF_BAND) expect(fns.has(key), `${key} is now created by a migration; move it to ALLOWED`).toBe(false);
  });
});
