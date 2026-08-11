// scripts/mobile-api-audit.ts
//
// Prints the mobile data-contract inventory: every RPC and table write the Flutter
// app performs, checked against what the schema actually exposes to a member's JWT.
//
// Run:  npx tsx scripts/mobile-api-audit.ts
//
// Exits non-zero when anything is unreachable, so it can gate CI. The permanent
// guard is `tests/unit/mobileRpcContract.test.ts`; this script is the readable
// report you work from while closing the gap.

import {
  auditEndpointContract,
  auditRpcCalls,
  dartEndpointCalls,
  dartRpcCalls,
  dartTableWrites,
  mobileRouteHandlers,
  sqlFunctions,
  type RpcFinding,
} from './lib/mobileContract.js';

function heading(text: string): void {
  console.log(`\n${text}`);
  console.log('─'.repeat(text.length));
}

const calls = dartRpcCalls();
const writes = dartTableWrites();
const functions = sqlFunctions();
const findings = auditRpcCalls();

const byKind = (kind: RpcFinding['kind']) => findings.filter((f) => f.kind === kind);
const unique = <T>(values: T[]) => [...new Set(values)];

heading('Summary');
console.log(`Dart RPC call sites          ${calls.length} (${unique(calls.map((c) => c.name)).length} distinct names)`);
console.log(`cardtrade functions in SQL   ${functions.size}`);
console.log(
  `  executable by authenticated  ${[...functions.values()].filter((f) => f.executeRoles.has('authenticated')).length}`,
);
console.log(`Direct table writes          ${writes.length}`);
console.log('');
console.log(`No such function             ${byKind('missing').length}`);
console.log(`Exists, not callable         ${byKind('not-executable').length}`);
console.log(`Callable, wrong params       ${byKind('params').length}`);

if (byKind('missing').length) {
  heading('No such function — the name does not exist anywhere in supabase/migrations');
  for (const f of byKind('missing')) {
    console.log(`  ${f.call.name.padEnd(34)} ${f.call.file}:${f.call.line}`);
  }
}

if (byKind('not-executable').length) {
  heading('Exists, but a member JWT cannot execute it');
  for (const f of byKind('not-executable')) {
    console.log(`  ${f.call.name.padEnd(34)} ${f.detail}`);
    console.log(`  ${' '.repeat(34)} called at ${f.call.file}:${f.call.line}`);
  }
}

if (byKind('params').length) {
  heading('Callable, but the argument list disagrees');
  for (const f of byKind('params')) {
    console.log(`  ${f.call.name.padEnd(34)} ${f.detail}`);
  }
}

heading('Functions authenticated MAY execute');
const open = [...functions.values()]
  .filter((f) => f.executeRoles.has('authenticated'))
  .map((f) => f.name)
  .sort();
console.log(open.length ? open.map((n) => `  ${n}`).join('\n') : '  (none)');

heading('Direct table writes from Dart');
const grouped = new Map<string, string[]>();
for (const write of writes) {
  const key = `${write.table}.${write.op}`;
  grouped.set(key, [...(grouped.get(key) ?? []), `${write.file}:${write.line}`]);
}
for (const [key, sites] of [...grouped].sort()) {
  console.log(`  ${key.padEnd(28)} ${sites.join(', ')}`);
}

const total = findings.length;
heading(total ? `${total} unreachable call site${total === 1 ? '' : 's'}` : 'All Dart RPC calls resolve');

// ─── Endpoint contract ──────────────────────────────────────────────────────────

heading('Endpoint contract (Dart declarations ⇄ route handlers)');
const endpoints = dartEndpointCalls();
const handlers = mobileRouteHandlers();
const endpointFindings = auditEndpointContract();

console.log(`Dart endpoint declarations   ${endpoints.length}`);
console.log(`Route handlers               ${handlers.length}`);

if (endpointFindings.dartWithoutHandler.length) {
  console.log('');
  console.log('Dart declares paths with no handler:');
  for (const entry of endpointFindings.dartWithoutHandler) {
    console.log(`  ${entry.path.padEnd(36)} ApiRoutes.${entry.name} (line ${entry.line})`);
  }
}

if (endpointFindings.handlerWithoutDart.length) {
  console.log('');
  console.log('Handlers with no Dart declaration:');
  for (const entry of endpointFindings.handlerWithoutDart) {
    console.log(`  ${entry.path}`);
  }
}

const endpointGap = endpointFindings.dartWithoutHandler.length + endpointFindings.handlerWithoutDart.length;
if (endpointGap === 0) {
  console.log('  ✓ All declarations pair with handlers');
}

heading(
  total || endpointGap
    ? `FAIL — ${total} unreachable RPC${total === 1 ? '' : 's'}, ${endpointGap} endpoint pairing gap${endpointGap === 1 ? '' : 's'}`
    : 'PASS — all Dart calls resolve and all endpoints pair',
);
process.exit(total || endpointGap ? 1 : 0);
