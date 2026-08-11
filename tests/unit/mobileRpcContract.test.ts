// tests/unit/mobileRpcContract.test.ts
//
// Pins `flutter_app/lib/services/**` to the RPCs the schema actually exposes.
//
// WHY THIS EXISTS. The Flutter app is a second client that speaks to Postgres
// directly rather than through the web app's Server Actions, so its write path is
// a set of RPC names typed into Dart string literals. Nothing checks them. Dart
// compiles, the screens render, the buttons look live, and every one of them fails
// at the network boundary — which is exactly what this test found on the day it was
// written: 23 of 23 call sites unreachable, 22 naming functions that do not exist
// and one naming a function granted to `service_role` alone.
//
// `flutter_app/SPEC.md` documented the intended data layer in detail and could not
// catch any of it, because prose cannot fail a build. This can.
//
// The rule being asserted is narrow and worth stating plainly: a call is viable from
// the mobile client only when the function EXISTS and `authenticated` holds EXECUTE
// on it. The Flutter client carries a member's JWT and nothing else — the
// service-role key bypasses RLS and must never ship inside an app bundle — so a
// function reserved to `service_role` is not "nearly callable", it is server-only by
// design. The remedy for one of those is an HTTP endpoint in front of the existing
// orchestrator, not a new grant.
//
// See `scripts/mobile-api-audit.ts` for the same data as a readable report.

import { describe, expect, it } from 'vitest';

import {
  auditEndpointContract,
  auditRpcCalls,
  dartEndpointCalls,
  dartRpcCalls,
  dartTableWrites,
  mobileRouteHandlers,
  sqlFunctions,
  type RpcFinding,
} from '@/scripts/lib/mobileContract';

/** One line per finding, so a failure names the file and line to open. */
function report(findings: RpcFinding[]): string {
  return findings
    .map((f) => `  ${f.call.name} — ${f.detail} (${f.call.file}:${f.call.line})`)
    .join('\n');
}

describe('the Flutter app only calls RPCs that exist and that a member may execute', () => {
  const calls = dartRpcCalls();
  const findings = auditRpcCalls();

  it('found RPC call sites to check (or confirms all RPCs have been migrated to endpoints)', () => {
    // When the app uses RPCs, this guards against a vacuous pass from a broken
    // parser. Once fully migrated to HTTP endpoints, zero RPCs is the correct
    // state — the endpoint-contract guard below takes over coverage checking.
    if (calls.length === 0) {
      // Zero RPCs is only valid if the endpoint guard is non-trivial.
      expect(dartEndpointCalls().length).toBeGreaterThan(0);
    } else {
      expect(calls.length).toBeGreaterThan(0);
    }
  });

  it('read the migrations and resolved their grants', () => {
    const functions = sqlFunctions();
    expect(functions.size).toBeGreaterThan(30);
    // `is_fraud_banned` is granted to `authenticated` in 0059 and never revoked.
    // If this stops holding, the privilege parser has broken rather than the schema.
    expect(functions.get('is_fraud_banned')?.executeRoles.has('authenticated')).toBe(true);
    // And a known server-only one, to prove revokes are being applied.
    expect(functions.get('begin_trade_collateral')?.executeRoles.has('authenticated')).toBe(
      false,
    );
  });

  it('names no RPC that is absent from the schema', () => {
    const missing = findings.filter((f) => f.kind === 'missing');
    expect(
      missing,
      `Dart calls RPCs that do not exist in supabase/migrations:\n${report(missing)}\n\n` +
        'Some are near-misses on real functions — create_cash_sale_agreement, ' +
        'apply_trade_tracking, decline_trade_negotiation — so fixing the name is ' +
        'not enough on its own: those are service_role only. Route these through ' +
        'the web app instead of inventing SQL for them.',
    ).toEqual([]);
  });

  it('calls nothing that only the service role may execute', () => {
    const blocked = findings.filter((f) => f.kind === 'not-executable');
    expect(
      blocked,
      `Dart calls RPCs a member JWT cannot execute:\n${report(blocked)}\n\n` +
        'Do not fix this by granting EXECUTE to authenticated. These functions are ' +
        'the tail end of an orchestration that also places Stripe holds and runs the ' +
        'Identity_Gate and region guards, none of which a client can do. Put an ' +
        'endpoint in front of the orchestrator and call that.',
    ).toEqual([]);
  });

  it('passes every required argument to the RPCs it does reach', () => {
    const wrong = findings.filter((f) => f.kind === 'params');
    expect(
      wrong,
      `Dart RPC argument lists disagree with the SQL signature:\n${report(wrong)}`,
    ).toEqual([]);
  });
});

describe('direct table writes from the Flutter app stay on member-owned rows', () => {
  // Writes that bypass an RPC are only safe where RLS alone is the whole rule and
  // there is no orchestration behind it. Watchlist entries, read receipts and a
  // member's own profile qualify. Anything on a contract does not: `cash_sales`,
  // `trades`, `cash_sale_items` and the hold tables all carry invariants enforced
  // above the row.
  const CONTRACT_TABLES = [
    'items',
    'cash_sales',
    'cash_sale_items',
    'cash_sale_delivery_details',
    'trades',
    'trade_items',
    'trade_delivery_details',
    'pre_auth_holds',
    'trade_fees',
    'disputes',
    'charge_disputes',
    'webhook_events',
  ];

  it('writes to no contract table directly', () => {
    const offenders = dartTableWrites().filter((write) =>
      CONTRACT_TABLES.includes(write.table),
    );
    expect(
      offenders.map((o) => `${o.table}.${o.op} at ${o.file}:${o.line}`),
      'a contract table was written from Dart, bypassing the orchestrator guards',
    ).toEqual([]);
  });
});

describe('every Dart endpoint declaration pairs with a route handler and vice versa', () => {
  const dartEntries = dartEndpointCalls();
  const handlers = mobileRouteHandlers();
  const findings = auditEndpointContract();

  it('parsed a non-zero count of Dart endpoint entries', () => {
    // A vacuous pass on zero entries means the parser broke, not that there are
    // no endpoints. The same reasoning as the RPC count guard above.
    expect(dartEntries.length).toBeGreaterThan(0);
  });

  it('parsed a non-zero count of route handlers', () => {
    expect(handlers.length).toBeGreaterThan(0);
  });

  it('declares no Dart endpoint path without a corresponding route handler', () => {
    const missing = findings.dartWithoutHandler;
    expect(
      missing.map((e) => `  ${e.path} (ApiRoutes.${e.name}, line ${e.line})`),
      'Dart declares endpoint paths that have no route.ts handler in app/api/mobile/. ' +
        'Either add the handler or remove the Dart declaration.',
    ).toEqual([]);
  });

  it('has no route handler without a corresponding Dart endpoint declaration', () => {
    const uncalled = findings.handlerWithoutDart;
    expect(
      uncalled.map((h) => `  ${h.path}`),
      'Route handlers exist in app/api/mobile/ with no corresponding entry in ' +
        'flutter_app/lib/core/api_routes.dart. An uncalled handler is an unaudited ' +
        'endpoint — either add the Dart entry or remove the handler.',
    ).toEqual([]);
  });
});
