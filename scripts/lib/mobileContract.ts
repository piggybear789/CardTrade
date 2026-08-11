// scripts/lib/mobileContract.ts
//
// Parsers that read the three sides of the mobile data contract straight out of
// source, so agreement between them can be asserted mechanically instead of
// maintained by hand in a spec document.
//
// WHY THIS EXISTS. `flutter_app/` is a second client. It does not import the web
// app's Server Actions or orchestrators — it speaks to Postgres directly — so every
// rule the steering docs describe as living in exactly ONE place acquires a second
// implementation the moment the Flutter app needs it. `flutter_app/SPEC.md` was the
// first attempt at holding the two in step and it could not: prose cannot fail a
// build, so it drifts as silently as the code it describes.
//
// These parsers exist to make the drift loud. They are deliberately strict and
// report what they could not understand rather than returning an empty set, because
// a check that vacuously passes on a file it failed to parse is worse than no check
// at all — the same reasoning as `tests/unit/regionCurrencyAgreement.test.ts`.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Both callers — `npx tsx scripts/…` and Vitest — run from the repo root, which is
// also how `tests/unit/regionCurrencyAgreement.test.ts` locates the migrations.
const REPO_ROOT = process.cwd();

/** Absolute path to `supabase/migrations`. */
export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');

/** Absolute path to the Flutter app's Dart sources. */
export const FLUTTER_LIB_DIR = path.join(REPO_ROOT, 'flutter_app', 'lib');

/** A `.rpc('name', params: {...})` call found in Dart. */
export interface DartRpcCall {
  /** The RPC name as the Dart code spells it. */
  name: string;
  /** The `p_*` keys passed in the `params` map, in source order. */
  paramKeys: string[];
  /** Repo-relative path of the Dart file. */
  file: string;
  /** 1-based line number of the call. */
  line: number;
}

/** A direct `from('table').insert/update/delete` write found in Dart. */
export interface DartTableWrite {
  table: string;
  op: 'insert' | 'update' | 'delete' | 'upsert';
  file: string;
  line: number;
}

/** A `cardtrade.*` function as the migrations leave it. */
export interface SqlFunction {
  name: string;
  /** Declared parameter names (`p_*`), from the newest definition. */
  paramNames: string[];
  /** Parameter names that declare a DEFAULT, so a caller may omit them. */
  optionalParamNames: string[];
  /** Roles holding EXECUTE after every grant/revoke in migration order. */
  executeRoles: Set<string>;
  /** Migration file the newest definition came from. */
  definedIn: string;
}

// ─── Dart ──────────────────────────────────────────────────────────────────────

function walkDart(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkDart(full, out);
    } else if (entry.endsWith('.dart') && !entry.endsWith('.g.dart') && !entry.endsWith('.freezed.dart')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract the block of source between the brace at or after `from` and its match.
 *
 * Brace-balanced rather than regex-based because a `params:` map spans lines and
 * frequently contains nested collection literals.
 */
function braceBlock(source: string, from: number): string | null {
  const open = source.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** Every RPC the Flutter app calls with a literal name. */
export function dartRpcCalls(): DartRpcCall[] {
  const calls: DartRpcCall[] = [];
  for (const file of walkDart(FLUTTER_LIB_DIR)) {
    const source = readFileSync(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    const pattern = /\.rpc\(\s*'([a-z_][a-z0-9_]*)'/g;

    for (const match of source.matchAll(pattern)) {
      const callStart = match.index!;
      // Only look for `params:` inside this call, not the next one.
      const nextCall = source.indexOf('.rpc(', callStart + 5);
      const horizon = nextCall === -1 ? source.length : nextCall;
      const paramsAt = source.indexOf('params:', callStart);

      let paramKeys: string[] = [];
      if (paramsAt !== -1 && paramsAt < horizon) {
        const block = braceBlock(source, paramsAt);
        if (block) {
          paramKeys = [...block.matchAll(/'(p_[a-z0-9_]+)'\s*:/g)].map((m) => m[1]);
        }
      }

      calls.push({ name: match[1], paramKeys, file: rel, line: lineOf(source, callStart) });
    }
  }
  return calls;
}

/** Every direct table write the Flutter app performs. */
export function dartTableWrites(): DartTableWrite[] {
  const writes: DartTableWrite[] = [];
  for (const file of walkDart(FLUTTER_LIB_DIR)) {
    const source = readFileSync(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    // Allows whitespace and newlines between `from('x')` and the mutation, which is
    // how the multi-line builder chains in `lib/services/` are formatted.
    const pattern = /from\(\s*'([a-z_][a-z0-9_]*)'\s*\)\s*\.\s*(insert|update|delete|upsert)\s*\(/g;

    for (const match of source.matchAll(pattern)) {
      writes.push({
        table: match[1],
        op: match[2] as DartTableWrite['op'],
        file: rel,
        line: lineOf(source, match.index!),
      });
    }
  }
  return writes;
}

// ─── SQL ───────────────────────────────────────────────────────────────────────

/** Migration files in applied order. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/**
 * Strip `--` line comments so prose in a migration cannot be read as code.
 *
 * `tests/property/identityGate.test.ts` records this hazard the hard way: a comment
 * describing a function body matches the pattern that looks for the body.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

function splitTopLevel(argBlock: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of argBlock) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Every `cardtrade.*` function, as the newest migration defining it leaves it,
 * with EXECUTE privileges resolved across all grant and revoke statements.
 *
 * Later migrations win: `create_cash_sale_agreement` is defined in 0008 and
 * redefined in 0064, and only the second one describes the shopfront behaviour.
 */
export function sqlFunctions(): Map<string, SqlFunction> {
  const functions = new Map<string, SqlFunction>();

  for (const fileName of migrationFiles()) {
    const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, fileName), 'utf8'));

    // Definitions.
    const defPattern =
      /create\s+or\s+replace\s+function\s+cardtrade\.(\w+)\s*\(([\s\S]*?)\)\s*returns/gi;
    for (const match of sql.matchAll(defPattern)) {
      const name = match[1];
      const args = splitTopLevel(match[2]);
      const paramNames: string[] = [];
      const optionalParamNames: string[] = [];

      for (const arg of args) {
        const named = arg.trim().match(/^(p_[a-z0-9_]+)\b/i);
        if (!named) continue;
        paramNames.push(named[1]);
        if (/\bdefault\b/i.test(arg)) optionalParamNames.push(named[1]);
      }

      const existing = functions.get(name);
      functions.set(name, {
        name,
        paramNames,
        optionalParamNames,
        executeRoles: existing?.executeRoles ?? new Set<string>(),
        definedIn: fileName,
      });
    }

    // Privileges, applied in the order they appear in the file.
    const privPattern =
      /(grant\s+execute|revoke\s+all)\s+on\s+function\s+cardtrade\.(\w+)\s*\(([\s\S]*?)\)\s*(?:to|from)\s+([^;]+);/gi;
    for (const match of sql.matchAll(privPattern)) {
      const isGrant = /grant/i.test(match[1]);
      const name = match[2];
      const roles = match[4]
        .split(',')
        .map((role) => role.trim().toLowerCase())
        .filter(Boolean);

      const entry = functions.get(name);
      if (!entry) continue; // A privilege on something never defined here.
      for (const role of roles) {
        if (isGrant) entry.executeRoles.add(role);
        else entry.executeRoles.delete(role);
      }
    }
  }

  return functions;
}

// ─── Comparison ────────────────────────────────────────────────────────────────

/** What is wrong with one Dart RPC call. */
export interface RpcFinding {
  call: DartRpcCall;
  /** `missing` — no such function. `not-executable` — exists, but not for `authenticated`. */
  kind: 'missing' | 'not-executable' | 'params';
  detail: string;
}

/**
 * Compare every Dart RPC call against the schema.
 *
 * A call is only viable from the mobile client when the function EXISTS and
 * `authenticated` holds EXECUTE on it — the Flutter client carries a member's JWT,
 * never the service-role key, which must never ship in an app bundle.
 */
export function auditRpcCalls(): RpcFinding[] {
  const functions = sqlFunctions();
  const findings: RpcFinding[] = [];

  for (const call of dartRpcCalls()) {
    const fn = functions.get(call.name);

    if (!fn) {
      findings.push({
        call,
        kind: 'missing',
        detail: 'no cardtrade function of this name exists in supabase/migrations',
      });
      continue;
    }

    if (!fn.executeRoles.has('authenticated')) {
      const roles = [...fn.executeRoles].sort().join(', ') || 'nobody';
      findings.push({
        call,
        kind: 'not-executable',
        detail: `defined in ${fn.definedIn}; EXECUTE held by ${roles}`,
      });
      continue;
    }

    const required = fn.paramNames.filter((p) => !fn.optionalParamNames.includes(p));
    const missing = required.filter((p) => !call.paramKeys.includes(p));
    const unknown = call.paramKeys.filter((p) => !fn.paramNames.includes(p));
    if (missing.length || unknown.length) {
      findings.push({
        call,
        kind: 'params',
        detail: [
          missing.length ? `missing ${missing.join(', ')}` : '',
          unknown.length ? `unknown ${unknown.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('; '),
      });
    }
  }

  return findings;
}

// ─── Endpoint contract ─────────────────────────────────────────────────────────

/** An endpoint path declared in `flutter_app/lib/core/api_routes.dart`. */
export interface DartEndpointEntry {
  /** The getter name (e.g. `listingsCreate`). */
  name: string;
  /** The relative path segment after `/api/mobile/` (e.g. `listings/create`). */
  path: string;
  /** 1-based line number in api_routes.dart. */
  line: number;
}

/** A route handler file at `app/api/mobile/<area>/<action>/route.ts`. */
export interface RouteHandlerEntry {
  /** The relative path segment after `/api/mobile/` (e.g. `listings/create`). */
  path: string;
  /** Absolute path to the route.ts file. */
  file: string;
}

const API_ROUTES_FILE = path.join(FLUTTER_LIB_DIR, 'core', 'api_routes.dart');
const MOBILE_API_DIR = path.join(REPO_ROOT, 'app', 'api', 'mobile');

/**
 * Every endpoint path declared in `flutter_app/lib/core/api_routes.dart`.
 *
 * Parses the `static String get <name> => '$base/<path>';` pattern.
 * Throws on a file it cannot parse at all, so a restructuring cannot turn the
 * guard into a vacuous pass.
 */
export function dartEndpointCalls(): DartEndpointEntry[] {
  const source = readFileSync(API_ROUTES_FILE, 'utf8');
  const entries: DartEndpointEntry[] = [];

  // Match: static String get <name> => '$base/<path>';
  // Also handle: static String get <name> => '${Env.webAppUrl}/api/mobile/<path>';
  const pattern = /static\s+String\s+get\s+(\w+)\s*=>\s*'\$base\/([^']+)'\s*;/g;

  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    const endpointPath = match[2];
    entries.push({
      name,
      path: endpointPath,
      line: lineOf(source, match.index!),
    });
  }

  // The `base` getter itself is not an endpoint — skip it.
  // But if we parsed zero entries, the file format changed and we should fail loud.
  if (entries.length === 0) {
    throw new Error(
      'dartEndpointCalls() parsed zero entries from flutter_app/lib/core/api_routes.dart. ' +
        'The getter pattern may have changed — update the parser rather than silencing this.',
    );
  }

  return entries;
}

/**
 * Every route handler at `app/api/mobile/<segments>/route.ts`.
 *
 * Walks the directory tree and extracts the path segments relative to the mobile
 * API root (e.g. `listings/create` from `app/api/mobile/listings/create/route.ts`).
 * Throws if the directory does not exist or contains no handlers.
 */
export function mobileRouteHandlers(): RouteHandlerEntry[] {
  const entries: RouteHandlerEntry[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === 'route.ts') {
        const relativePath = path.relative(MOBILE_API_DIR, path.dirname(full)).replace(/\\/g, '/');
        entries.push({ path: relativePath, file: full });
      }
    }
  }

  if (!existsSync(MOBILE_API_DIR)) {
    throw new Error(
      `mobileRouteHandlers() cannot find ${MOBILE_API_DIR}. ` +
        'Has the mobile API directory moved?',
    );
  }

  walk(MOBILE_API_DIR);

  if (entries.length === 0) {
    throw new Error(
      'mobileRouteHandlers() found zero route.ts files in app/api/mobile/. ' +
        'The handlers must exist before the guard can be meaningful.',
    );
  }

  return entries;
}

/**
 * Compare endpoint declarations in Dart against route handlers.
 * Returns paths that appear in one side but not the other.
 */
export interface EndpointContractFindings {
  /** Paths declared in Dart but missing a route handler. */
  dartWithoutHandler: DartEndpointEntry[];
  /** Route handlers that have no corresponding Dart declaration. */
  handlerWithoutDart: RouteHandlerEntry[];
}

export function auditEndpointContract(): EndpointContractFindings {
  const dartEntries = dartEndpointCalls();
  const handlers = mobileRouteHandlers();

  const dartPaths = new Set(dartEntries.map((e) => e.path));
  const handlerPaths = new Set(handlers.map((h) => h.path));

  return {
    dartWithoutHandler: dartEntries.filter((e) => !handlerPaths.has(e.path)),
    handlerWithoutDart: handlers.filter((h) => !dartPaths.has(h.path)),
  };
}

// ─── Dart ⇄ TypeScript agreement ───────────────────────────────────────────────

const CAMEL_TO_SCREAMING = (name: string): string =>
  name.replace(/[A-Z]/g, (char) => `_${char}`).toUpperCase();

function readFlutter(relative: string): string {
  return readFileSync(path.join(FLUTTER_LIB_DIR, ...relative.split('/')), 'utf8');
}

/**
 * The `@JsonValue('X')` wire values of one Dart enum, in declaration order.
 *
 * Reads the wire value rather than the Dart identifier because the wire value is
 * what Postgres stores and therefore what has to agree with the TypeScript union.
 * Throws on an unknown enum so a rename cannot turn this into a vacuous pass.
 */
export function dartEnumValues(enumName: string, file = 'models/enums.dart'): string[] {
  const source = readFlutter(file);
  const declaration = source.indexOf(`enum ${enumName} {`);
  if (declaration === -1) {
    throw new Error(`enum ${enumName} not found in flutter_app/lib/${file}`);
  }
  const block = braceBlock(source, declaration);
  if (!block) throw new Error(`could not read the body of enum ${enumName}`);
  return [...block.matchAll(/@JsonValue\(\s*'([A-Z0-9_]+)'\s*\)/g)].map((m) => m[1]);
}

/**
 * Members of a TypeScript string-literal union, read from source.
 *
 * `TradeAction` and `TradeEvent` are types with no runtime representation, so there
 * is nothing to import and compare — the declaration itself is the only artifact.
 */
export function tsUnionMembers(typeName: string, relativeFile: string): string[] {
  const raw = readFileSync(path.join(REPO_ROOT, ...relativeFile.split('/')), 'utf8');
  // Comments come off BEFORE the declaration is located, not after. `TradeEvent`
  // annotates HANDOVER_FAILED with "freeze WITHOUT capturing" — and that semicolon
  // terminated the non-greedy match five members early, which read as drift the
  // first time this ran. Anything that hunts for a terminator has to see code only.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const declaration = source.match(
    new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?);`, 'm'),
  );
  if (!declaration) throw new Error(`type ${typeName} not found in ${relativeFile}`);

  const members = [...declaration[1].matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
  if (members.length === 0) {
    throw new Error(`parsed zero members from ${typeName} in ${relativeFile}`);
  }
  return members;
}

/** The Dart transition table, keyed and valued in the SQL/TypeScript spelling. */
export function dartTransitions(): Record<string, Record<string, string>> {
  const source = readFlutter('domain/state_machine/machine.dart');
  const start = source.indexOf('transitions = {');
  if (start === -1) throw new Error('transitions table not found in machine.dart');
  const block = braceBlock(source, start);
  if (!block) throw new Error('could not read the transitions table body');

  const table: Record<string, Record<string, string>> = {};
  const statePattern = /TradeState\.(\w+)\s*:\s*\{/g;

  for (const match of block.matchAll(statePattern)) {
    const from = CAMEL_TO_SCREAMING(match[1]);
    const inner = braceBlock(block, match.index! + match[0].length - 1);
    table[from] = {};
    if (!inner) continue;
    for (const edge of inner.matchAll(/TradeEvent\.(\w+)\s*:\s*TradeState\.(\w+)/g)) {
      table[from][CAMEL_TO_SCREAMING(edge[1])] = CAMEL_TO_SCREAMING(edge[2]);
    }
  }
  return table;
}

/** A row of the Dart region registry. */
export interface DartRegion {
  code: string;
  label: string;
  currency: string;
  minorUnitDigits: number;
  tradingEnabled: boolean;
}

/** The Dart region registry, which duplicates `domain/region/regions.ts`. */
export function dartRegions(): DartRegion[] {
  const source = readFlutter('domain/region/regions.dart');
  const pattern =
    /Region\(\s*code:\s*'([A-Z]{2})',\s*label:\s*'([^']*)',\s*currency:\s*'([a-z]{3})',\s*minorUnitDigits:\s*(\d+)\s*(?:,\s*tradingEnabled:\s*(true|false)\s*)?,?\s*\)/g;

  return [...source.matchAll(pattern)].map((match) => ({
    code: match[1],
    label: match[2],
    currency: match[3],
    minorUnitDigits: Number(match[4]),
    tradingEnabled: match[5] === 'true',
  }));
}

/** The zero-decimal currency set hard-coded in `core/money.dart`. */
export function dartZeroDecimalCurrencies(): string[] {
  const source = readFlutter('core/money.dart');
  const start = source.indexOf('zeroDecimal');
  if (start === -1) throw new Error('zeroDecimal set not found in money.dart');
  const block = braceBlock(source, start);
  if (!block) throw new Error('could not read the zeroDecimal set body');
  return [...block.matchAll(/'([a-z]{3})'/g)].map((m) => m[1]);
}

/**
 * Every Dart identifier, path segment and route referencing retired vocabulary.
 *
 * `Deal` went with migration 0055 and `KYC_Status` before it. The web app cannot
 * reintroduce them without a compile error, because the tables and types are gone;
 * the Flutter app can, because it names everything as a string.
 */
export function dartRetiredVocabularyHits(terms: string[]): { term: string; file: string; line: number }[] {
  const hits: { term: string; file: string; line: number }[] = [];
  for (const file of walkDart(FLUTTER_LIB_DIR)) {
    const source = readFileSync(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    for (const term of terms) {
      const pattern = new RegExp(`\\b${term}\\b`, 'gi');
      for (const match of source.matchAll(pattern)) {
        hits.push({ term, file: rel, line: lineOf(source, match.index!) });
      }
    }
  }
  return hits;
}
