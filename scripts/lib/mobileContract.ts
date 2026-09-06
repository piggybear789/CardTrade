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
import { transformSync } from 'esbuild';
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


// ─── Mobile visual parity contract ───────────────────────────────────────────
//
// These parsers are intentionally separate from the RPC/domain contract above.
// They read the web design tokens and the future split Dart theme layer directly so
// tests can pin their agreement without maintaining a third copy of either system.

export interface SourceRef {
  file: string;
  line: number;
}

export interface WebRootDeclaration extends SourceRef {
  token: string;
  raw: string;
  kind: 'hsl' | 'alias' | 'length' | 'duration' | 'unrecognised';
}

export interface WebColorToken extends SourceRef {
  token: string;
  camel: string;
  hsl: [number, number, number];
  aliasOf: string | null;
}

export interface WebTypeLevel extends SourceRef {
  token: string;
  px: number;
  lineHeight: number;
}

export interface WebLength extends SourceRef {
  token: string;
  px: number;
  derivedFrom: string | null;
}

export interface WebShadowLayer {
  dx: number;
  dy: number;
  blur: number;
  spread: number;
  alpha: number;
  colorToken: string;
}

export interface WebShadowToken extends SourceRef {
  token: string;
  layers: WebShadowLayer[];
}

export interface DartColorConst extends SourceRef {
  identifier: string;
  argb: number;
  aliasTarget: string | null;
}

export interface DartTypeLevel extends SourceRef {
  identifier: string;
  px: number;
  height: number;
  letterSpacing: number | null;
  hasWeight: boolean;
  hasColor: boolean;
}

export interface DartTextRole extends SourceRef {
  identifier: string;
  px: number;
  height: number;
  weight: number | null;
  colorIdentifier: string | null;
  letterSpacing: number | null;
  fontFeatures: string[];
}

export interface DartNumeric extends SourceRef {
  identifier: string;
  value: number;
}

export interface DartShadow extends SourceRef {
  identifier: string;
  layers: { dx: number; dy: number; cssBlur: number; spread: number; alpha: number; colorIdentifier: string }[];
}

export interface DartTint extends SourceRef {
  identifier: string;
  fill: { colorIdentifier: string; alpha: number } | null;
  edge: { colorIdentifier: string; alpha: number } | null;
  ink: { colorIdentifier: string; alpha: number } | null;
}

export interface DartContrastPair extends SourceRef {
  fg: string;
  bg: string;
  level: string | null;
  role: 'text' | 'controlEdge' | 'focus' | 'stateGraphic';
}

export interface DartSchemeSlot extends SourceRef {
  slot: string;
  colorIdentifier: string | null;
}

export interface DartAlias extends SourceRef {
  identifier: string;
  replacement: string;
  referenceCount: number;
  /** The count recorded in the marker comment; the ratchet may only fall below it. */
  recordedCount: number;
}

export type LiteralKind =
  | 'fontSize' | 'spacing' | 'iconSize' | 'strokeWidth' | 'shadowBlur'
  | 'colorLiteral' | 'materialIcon' | 'fontWeight' | 'currencySymbol'
  | 'minorUnitDivisor' | 'glyphName' | 'navLevel' | 'textColor';

export interface DartLiteralHit extends SourceRef {
  kind: LiteralKind;
  text: string;
  value: number | null;
}

export interface IconMapEntry extends SourceRef {
  web: string;
  flutter: string;
  reason: string | null;
}

export interface TokenFinding {
  kind: 'missing-in-dart' | 'missing-in-web' | 'value-differs' | 'surplus' | 'unparsed' | 'below-contrast-floor' | 'ratchet-loosened';
  token: string;
  webValue: string | null;
  dartValue: string | null;
  web: SourceRef | null;
  dart: SourceRef | null;
  criterion: string;
  detail: string;
}

const GLOBALS_CSS = path.join(REPO_ROOT, 'app', 'globals.css');
const TAILWIND_CONFIG = path.join(REPO_ROOT, 'tailwind.config.ts');
const THEME_DIR = path.join(FLUTTER_LIB_DIR, 'core', 'theme');
const LEGACY_THEME_FILE = path.join(FLUTTER_LIB_DIR, 'core', 'theme.dart');
const MOBILE_SCREEN_DIRS = [
  path.join(FLUTTER_LIB_DIR, 'features'),
  path.join(FLUTTER_LIB_DIR, 'widgets'),
];

function repoPath(file: string): string {
  return path.relative(REPO_ROOT, file).replace(/\\/g, '/');
}

function visualError(file: string, line: number, message: string): never {
  throw new Error(`${repoPath(file)}:${line}: ${message}`);
}

function stripDartCommentsAndStrings(source: string): string {
  let result = '';
  let index = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' = 'code';
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') { state = 'line'; result += '  '; index += 2; continue; }
      if (char === '/' && next === '*') { state = 'block'; result += '  '; index += 2; continue; }
      if (char === "'") { state = 'single'; result += ' '; index += 1; continue; }
      if (char === '"') { state = 'double'; result += ' '; index += 1; continue; }
      result += char;
    } else if (state === 'line') {
      if (char === '\n') { state = 'code'; result += '\n'; } else result += ' ';
    } else if (state === 'block') {
      if (char === '*' && next === '/') { state = 'code'; result += '  '; index += 2; continue; }
      result += char === '\n' ? '\n' : ' ';
    } else {
      const quote = state === 'single' ? "'" : '"';
      if (char === '\\') { result += '  '; index += 2; continue; }
      if (char === quote) { state = 'code'; result += ' '; } else result += char === '\n' ? '\n' : ' ';
    }
    index += 1;
  }
  if (state === 'block' || state === 'single' || state === 'double') {
    throw new Error(`Dart source contains an unterminated ${state} section`);
  }
  return result;
}

function stripCssComments(source: string, file: string): string {
  if (/\/\*[\s\S]*$/.test(source) && !/\*\//.test(source.slice(source.lastIndexOf('/*')))) {
    throw new Error(`${repoPath(file)}: unterminated CSS comment`);
  }
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function sourceBlock(source: string, marker: string, file: string): { block: string; start: number } {
  const markerAt = source.indexOf(marker);
  if (markerAt === -1) visualError(file, 1, `cannot find ${marker} block`);
  const open = source.indexOf('{', markerAt + marker.length);
  if (open === -1) visualError(file, lineOf(source, markerAt), `${marker} has no opening brace`);
  const block = braceBlock(source, open);
  if (!block || block.length <= 2) visualError(file, lineOf(source, markerAt), `${marker} block is empty or unbalanced`);
  return { block, start: open };
}

function cssVariableCamel(token: string): string {
  return token.replace(/^--/, '').replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function parseHsl(raw: string, file: string, line: number): [number, number, number] {
  const match = raw.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))\s+((?:\d+\.?\d*|\.\d+))%\s+((?:\d+\.?\d*|\.\d+))%$/);
  if (!match) visualError(file, line, `expected an HSL triple, got ${raw}`);
  const hsl: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!Number.isFinite(hsl[0]) || hsl[1] < 0 || hsl[1] > 100 || hsl[2] < 0 || hsl[2] > 100) {
    visualError(file, line, `invalid HSL triple ${raw}`);
  }
  return hsl;
}

/** Every declaration in the `:root` token block, including non-colour values. */
export function webRootDeclarations(cssFile = GLOBALS_CSS): WebRootDeclaration[] {
  const source = stripCssComments(readFileSync(cssFile, 'utf8'), cssFile);
  const { block, start } = sourceBlock(source, ':root', cssFile);
  const declarations: WebRootDeclaration[] = [];
  const pattern = /(--[a-z][a-z0-9-]*)\s*:\s*([^;{}]+);/g;
  let consumed = block.replace(/^\{|\}$/g, '');
  for (const match of block.matchAll(pattern)) {
    const raw = match[2].trim();
    const line = lineOf(source, start + match.index!);
    let kind: WebRootDeclaration['kind'];
    if (/^-?(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)%\s+(?:\d+\.?\d*|\.\d+)%$/.test(raw)) kind = 'hsl';
    else if (/^var\(--[a-z][a-z0-9-]*\)$/.test(raw)) kind = 'alias';
    else if (/^(?:\d+(?:\.\d+)?)(?:px|rem)$/.test(raw) || /^calc\(var\(--[a-z][a-z0-9-]*\)\s*-\s*\d+(?:\.\d+)?px\)$/.test(raw)) kind = 'length';
    else if (/^\d+(?:\.\d+)?(?:ms|s)$/.test(raw)) kind = 'duration';
    else kind = 'unrecognised';
    declarations.push({ token: match[1], raw, kind, file: repoPath(cssFile), line });
    consumed = consumed.replace(match[0], '');
  }
  if (declarations.length === 0) visualError(cssFile, lineOf(source, start), ':root has no declarations');
  if (consumed.replace(/[\s;]/g, '').length > 0) {
    visualError(cssFile, lineOf(source, start), `cannot parse :root content ${consumed.trim().slice(0, 80)}`);
  }
  for (const declaration of declarations) {
    if (declaration.kind === 'unrecognised') visualError(cssFile, declaration.line, `unrecognised :root declaration ${declaration.token}: ${declaration.raw}`);
  }
  return declarations;
}

/** `:root` HSL colours resolved through strict, bounded `var()` chains. */
export function webColorTokens(cssFile = GLOBALS_CSS): WebColorToken[] {
  const declarations = webRootDeclarations(cssFile);
  const byToken = new Map(declarations.map((declaration) => [declaration.token, declaration]));
  const resolve = (token: string, seen: string[] = []): { hsl: [number, number, number]; aliasOf: string | null } => {
    if (seen.includes(token)) throw new Error(`${repoPath(cssFile)}: circular var() chain: ${[...seen, token].join(' → ')}`);
    if (seen.length >= 16) throw new Error(`${repoPath(cssFile)}: var() chain exceeded 16 references: ${[...seen, token].join(' → ')}`);
    const declaration = byToken.get(token);
    if (!declaration) throw new Error(`${repoPath(cssFile)}: unresolved CSS variable ${token}`);
    if (declaration.kind === 'hsl') return { hsl: parseHsl(declaration.raw, cssFile, declaration.line), aliasOf: seen[0] ?? null };
    if (declaration.kind !== 'alias') {
      throw new Error(`${declaration.file}:${declaration.line}: ${[...seen, token].join(' → ')} resolves to non-colour ${declaration.raw}`);
    }
    return resolve(declaration.raw.slice(4, -1), [...seen, token]);
  };
  const colours = declarations.filter((declaration) => declaration.kind === 'hsl' || declaration.kind === 'alias').map((declaration) => {
    const resolved = resolve(declaration.token);
    return { token: declaration.token, camel: cssVariableCamel(declaration.token), hsl: resolved.hsl, aliasOf: declaration.kind === 'alias' ? declaration.raw.slice(4, -1) : null, file: declaration.file, line: declaration.line };
  });
  if (colours.length === 0) throw new Error(`${repoPath(cssFile)}: parsed zero colour tokens from :root`);
  return colours;
}

function toLogicalPixels(raw: string, vars: Map<string, string>, file: string, line: number): { px: number; derivedFrom: string | null } {
  const plain = raw.trim().match(/^(\d+(?:\.\d+)?)(px|rem)$/);
  if (plain) return { px: Number(plain[1]) * (plain[2] === 'rem' ? 16 : 1), derivedFrom: null };
  const variable = raw.trim().match(/^var\((--[a-z][a-z0-9-]*)\)$/);
  if (variable) {
    const base = vars.get(variable[1]);
    if (!base) visualError(file, line, `length references unknown variable ${variable[1]}`);
    return { px: toLogicalPixels(base, vars, file, line).px, derivedFrom: variable[1] };
  }
  const calc = raw.trim().match(/^calc\(var\((--[a-z][a-z0-9-]*)\)\s*-\s*(\d+(?:\.\d+)?)px\)$/);
  if (calc) {
    const base = vars.get(calc[1]);
    if (!base) visualError(file, line, `calc() references unknown variable ${calc[1]}`);
    return { px: toLogicalPixels(base, vars, file, line).px - Number(calc[2]), derivedFrom: calc[1] };
  }
  visualError(file, line, `unsupported length ${raw}`);
}

function importedTailwind(): Record<string, unknown> {
  // Execute the TypeScript module instead of regex-parsing it. Vitest's ESM loader
  // cannot load this config through CommonJS `require`, so transpile the module to
  // CommonJS first while preserving its runtime object shape.
  const source = readFileSync(TAILWIND_CONFIG, 'utf8');
  const compiled = transformSync(source, {
    format: 'cjs',
    loader: 'ts',
    sourcefile: TAILWIND_CONFIG,
    target: 'es2022',
  }).code;
  const module = { exports: {} as unknown };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', compiled)(module, module.exports, require);
  const loaded = module.exports as { default?: unknown } | unknown;
  const config = (loaded as { default?: unknown }).default ?? loaded;
  if (!config || typeof config !== 'object') throw new Error('tailwind.config.ts did not export an object');
  return config as Record<string, unknown>;
}

function tailwindExtend(): Record<string, unknown> {
  const config = importedTailwind();
  const theme = config.theme as Record<string, unknown> | undefined;
  const extend = theme?.extend;
  if (!extend || typeof extend !== 'object') throw new Error('tailwind.config.ts has no theme.extend block');
  return extend as Record<string, unknown>;
}

function tailwindMap(name: string): Record<string, unknown> {
  const value = tailwindExtend()[name];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`tailwind.config.ts has no theme.extend.${name} block`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) throw new Error(`tailwind.config.ts theme.extend.${name} is empty`);
  return value as Record<string, unknown>;
}

/** Imported Tailwind type levels, never inferred by regexing the config source. */
export function webFontSizeLevels(): WebTypeLevel[] {
  const levels: WebTypeLevel[] = [];
  for (const [token, value] of Object.entries(tailwindMap('fontSize'))) {
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || !value[1] || typeof value[1] !== 'object') {
      throw new Error(`tailwind.config.ts fontSize.${token} has an unsupported shape`);
    }
    const lineHeight = (value[1] as Record<string, unknown>).lineHeight;
    const size = value[0].match(/^(\d+(?:\.\d+)?)rem$/);
    if (!size || typeof lineHeight !== 'string' || !/^\d+(?:\.\d+)?$/.test(lineHeight)) {
      throw new Error(`tailwind.config.ts fontSize.${token} must be a rem size with unitless lineHeight`);
    }
    levels.push({ token, px: Number(size[1]) * 16, lineHeight: Number(lineHeight), file: 'tailwind.config.ts', line: 1 });
  }
  return levels;
}

/** Imported Tailwind spacing steps as logical pixel lengths. */
export function webSpacingSteps(): WebLength[] {
  return Object.entries(tailwindMap('spacing')).map(([token, value]) => {
    if (typeof value !== 'string') throw new Error(`tailwind.config.ts spacing.${token} is not a string length`);
    const parsed = toLogicalPixels(value, new Map(), TAILWIND_CONFIG, 1);
    return { token, ...parsed, file: 'tailwind.config.ts', line: 1 };
  });
}

/** The `--radius` root declaration in logical pixels; the base every radius derives from. */
export function webRadiusBase(): WebLength {
  const declaration = webRootDeclarations().find((entry) => entry.token === '--radius');
  if (!declaration) throw new Error('app/globals.css :root has no --radius declaration');
  const parsed = toLogicalPixels(declaration.raw, new Map(), GLOBALS_CSS, declaration.line);
  return { token: declaration.token, ...parsed, file: declaration.file, line: declaration.line };
}

/** Imported Tailwind radius values, deriving calc() values from the CSS `--radius`. */
export function webRadiusValues(): WebLength[] {
  const root = new Map(webRootDeclarations().map((declaration) => [declaration.token, declaration.raw]));
  return Object.entries(tailwindMap('borderRadius')).map(([token, value]) => {
    if (typeof value !== 'string') throw new Error(`tailwind.config.ts borderRadius.${token} is not a string length`);
    const parsed = toLogicalPixels(value, root, TAILWIND_CONFIG, 1);
    return { token, ...parsed, file: 'tailwind.config.ts', line: 1 };
  });
}

function splitTopLevelCommas(source: string): string[] {
  const values: string[] = [];
  let depth = 0;
  let part = '';
  for (const char of source) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (depth < 0) throw new Error(`unbalanced parenthesis in ${source}`);
    if (char === ',' && depth === 0) { values.push(part.trim()); part = ''; } else part += char;
  }
  if (depth !== 0 || !part.trim()) throw new Error(`unbalanced or empty shadow layer list ${source}`);
  values.push(part.trim());
  return values;
}

/** Imported Tailwind shadows with comma splitting that respects colour-function depth. */
export function webShadowTokens(): WebShadowToken[] {
  return Object.entries(tailwindMap('boxShadow')).map(([token, value]) => {
    if (typeof value !== 'string') throw new Error(`tailwind.config.ts boxShadow.${token} is not a string`);
    const layers = splitTopLevelCommas(value).map((layer) => {
      const match = layer.match(/^(-?\d+(?:\.\d+)?)(?:px)?\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px(?:\s+(-?\d+(?:\.\d+)?)px)?\s+hsl\(var\((--[a-z][a-z0-9-]*)\)\s*\/\s*(0?(?:\.\d+)?|1(?:\.0+)?)\)$/);
      if (!match) throw new Error(`tailwind.config.ts boxShadow.${token} has an unsupported layer ${layer}`);
      return { dx: Number(match[1]), dy: Number(match[2]), blur: Number(match[3]), spread: Number(match[4] ?? 0), colorToken: match[5], alpha: Number(Number(match[6]).toFixed(2)) };
    });
    if (layers.length === 0) throw new Error(`tailwind.config.ts boxShadow.${token} has no layers`);
    return { token, layers, file: 'tailwind.config.ts', line: 1 };
  });
}

/**
 * Extract the parenthesised argument list at or after `from`, balanced across nesting.
 *
 * Paren-balanced rather than regex-based because a `BoxShadow(` layer contains
 * `withValues(alpha: …)` and `Offset(x, y)`, so the first `)` is never the layer's.
 */
function parenBlock(source: string, from: number): string | null {
  const open = source.indexOf('(', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

function themeFiles(): string[] {
  if (existsSync(THEME_DIR)) {
    // Unlike walkDart, the generated `tokens.g.dart` IS the palette this harness pins,
    // so the theme directory deliberately includes generated Dart.
    const files = readdirSync(THEME_DIR)
      .filter((entry) => entry.endsWith('.dart'))
      .map((entry) => path.join(THEME_DIR, entry));
    if (files.length === 0) throw new Error(`${repoPath(THEME_DIR)} has no Dart files`);
    return files;
  }
  if (existsSync(LEGACY_THEME_FILE)) return [LEGACY_THEME_FILE];
  throw new Error('Flutter theme layer is missing');
}

function readThemeClass(name: string): { source: string; file: string; block: string; offset: number } {
  for (const file of themeFiles()) {
    const source = readFileSync(file, 'utf8');
    const match = new RegExp(`abstract\\s+final\\s+class\\s+${name}\\s*\\{`).exec(source);
    if (!match || match.index === undefined) continue;
    const block = braceBlock(source, match.index + match[0].length - 1);
    if (!block) visualError(file, lineOf(source, match.index), `unbalanced ${name} class body`);
    return { source, file, block, offset: match.index + match[0].length - 1 };
  }
  throw new Error(`Flutter theme layer has no abstract final class ${name}`);
}

function staticMembers(className: string, pattern: RegExp): { match: RegExpMatchArray; source: string; file: string; line: number }[] {
  const found = readThemeClass(className);
  const members = [...found.block.matchAll(pattern)].map((match) => ({ match, source: found.source, file: found.file, line: lineOf(found.source, found.offset + (match.index ?? 0)) }));
  if (members.length === 0) throw new Error(`${repoPath(found.file)}:${lineOf(found.source, found.offset)}: ${className} has no parseable members`);
  return members;
}

/** AppColors constants, including only values that can be reduced to opaque ARGB. */
export function dartColorConstants(): DartColorConst[] {
  const colourPattern = /static\s+const\s+Color\s+(\w+)\s*=\s*Color\(0x([0-9A-Fa-f]{8})\)\s*;/g;
  return staticMembers('AppColors', colourPattern).map(({ match, file, line }) => ({
    identifier: match[1], argb: Number.parseInt(match[2], 16), aliasTarget: null, file: repoPath(file), line,
  }));
}

function parseTextStyleMembers(className: string): { identifier: string; body: string; file: string; line: number }[] {
  const found = readThemeClass(className);
  const pattern = /static\s+(?:const\s+)?TextStyle\s+(\w+)\s*=\s*(?:const\s+)?TextStyle\s*\(/g;
  const styles: { identifier: string; body: string; file: string; line: number }[] = [];
  for (const match of found.block.matchAll(pattern)) {
    const start = found.offset + (match.index ?? 0) + match[0].lastIndexOf('{');
    const open = found.source.indexOf('(', found.offset + (match.index ?? 0));
    let depth = 0;
    let end = -1;
    for (let i = open; i < found.source.length; i += 1) {
      if (found.source[i] === '(') depth += 1;
      if (found.source[i] === ')') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) visualError(found.file, lineOf(found.source, start), `unbalanced TextStyle ${match[1]}`);
    styles.push({ identifier: match[1], body: found.source.slice(open + 1, end), file: found.file, line: lineOf(found.source, found.offset + (match.index ?? 0)) });
  }
  if (styles.length === 0) throw new Error(`${repoPath(found.file)}:${lineOf(found.source, found.offset)}: ${className} has no TextStyle members`);
  return styles;
}

function numericArgument(body: string, name: string, file: string, line: number, required: boolean): number | null {
  const match = new RegExp(`\\b${name}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\b`).exec(body);
  if (!match) { if (required) visualError(file, line, `TextStyle has no numeric ${name}`); return null; }
  return Number(match[1]);
}

/** Parsed AppType levels; every level must reduce to numeric size and height. */
export function dartTypeLevels(): DartTypeLevel[] {
  return parseTextStyleMembers('AppType').map((style) => ({
    identifier: style.identifier,
    px: numericArgument(style.body, 'fontSize', style.file, style.line, true)!,
    height: numericArgument(style.body, 'height', style.file, style.line, true)!,
    letterSpacing: numericArgument(style.body, 'letterSpacing', style.file, style.line, false),
    hasWeight: /\bfontWeight\s*:/.test(style.body),
    hasColor: /\bcolor\s*:/.test(style.body),
    file: repoPath(style.file), line: style.line,
  }));
}

/** Parsed semantic AppText styles. */
export function dartTextRoles(): DartTextRole[] {
  const found = readThemeClass('AppText');
  // A role may name a shared font-feature list instead of repeating it; resolve the
  // indirection rather than reading the role as declaring no features at all.
  const featureLists = new Map<string, string[]>();
  for (const list of found.block.matchAll(/static\s+const\s+(\w+)\s*=\s*(?:const\s+)?\[([^\]]*)\]\s*;/g)) {
    const features = [...list[2].matchAll(/FontFeature\.(\w+)\s*\(/g)].map((match) => match[1]);
    if (features.length > 0) featureLists.set(list[1], features);
  }
  return parseTextStyleMembers('AppText').map((style) => {
    const colour = /\bcolor\s*:\s*AppColors\.(\w+)/.exec(style.body);
    const weight = /\bfontWeight\s*:\s*FontWeight\.w(\d{3})/.exec(style.body);
    const inline = [...style.body.matchAll(/FontFeature\.(\w+)\s*\(/g)].map((match) => match[1]);
    const named = /\bfontFeatures\s*:\s*(\w+)\b/.exec(style.body);
    if (inline.length === 0 && named) {
      const resolved = featureLists.get(named[1]);
      if (!resolved) visualError(style.file, style.line, `fontFeatures names unresolvable list ${named[1]}`);
      inline.push(...resolved);
    }
    return {
      identifier: style.identifier,
      px: numericArgument(style.body, 'fontSize', style.file, style.line, true)!,
      height: numericArgument(style.body, 'height', style.file, style.line, true)!,
      weight: weight ? Number(weight[1]) : null,
      colorIdentifier: colour?.[1] ?? null,
      letterSpacing: numericArgument(style.body, 'letterSpacing', style.file, style.line, false),
      fontFeatures: inline,
      file: repoPath(style.file), line: style.line,
    };
  });
}

function dartNumericClass(className: string): DartNumeric[] {
  // A member is either a literal or a single addition/subtraction against an earlier
  // member of the same class, which is how `AppRadius` derives sm/md/lg from its base.
  const pattern = /static\s+const\s+(?:(?:double|num|int)\s+)?(\w+)\s*=\s*(-?\d+(?:\.\d+)?|_?\w+(?:\s*[-+]\s*\d+(?:\.\d+)?)?)\s*;/g;
  const parsed = staticMembers(className, pattern);
  const resolved = new Map<string, number>();
  const members: DartNumeric[] = [];
  for (const { match, file, line } of parsed) {
    const raw = match[2].trim();
    let value: number;
    const literal = /^-?\d+(?:\.\d+)?$/.exec(raw);
    if (literal) value = Number(literal[0]);
    else {
      const derived = /^(_?\w+)(?:\s*([-+])\s*(\d+(?:\.\d+)?))?$/.exec(raw);
      if (!derived) visualError(file, line, `${className}.${match[1]} has an unsupported value ${raw}`);
      const base = resolved.get(derived[1]);
      if (base === undefined) visualError(file, line, `${className}.${match[1]} derives from unknown member ${derived[1]}`);
      value = derived[2] === undefined ? base : derived[2] === '-' ? base - Number(derived[3]) : base + Number(derived[3]);
    }
    resolved.set(match[1], value);
    // A private member is a derivation base, not a token, so it is not compared.
    if (!match[1].startsWith('_')) members.push({ identifier: match[1], value, file: repoPath(file), line });
  }
  if (members.length === 0) throw new Error(`${className} declares no public numeric members`);
  return members;
}

export function dartSpacingSteps(): DartNumeric[] { return dartNumericClass('AppSpacing'); }
export function dartRadiusValues(): DartNumeric[] { return dartNumericClass('AppRadius'); }
export function dartIconSizes(): DartNumeric[] { return dartNumericClass('AppIconSize'); }

/** AppElevation entries, expected to declare a CSS-convention `cssBlur:` per layer. */
export function dartElevations(): DartShadow[] {
  const found = readThemeClass('AppElevation');
  const entry = /static\s+(?:final\s+)?List<BoxShadow>\s+(\w+)\s*=\s*\[([\s\S]*?)\];/g;
  const elevations: DartShadow[] = [];
  for (const match of found.block.matchAll(entry)) {
    const layerBodies: string[] = [];
    for (const layer of match[2].matchAll(/BoxShadow\s*\(/g)) {
      const block = parenBlock(match[2], layer.index ?? 0);
      if (!block) visualError(found.file, lineOf(found.source, found.offset + (match.index ?? 0)), `AppElevation.${match[1]} has an unbalanced BoxShadow layer`);
      layerBodies.push(block.slice(1, -1));
    }
    const layers = layerBodies.map((body) => {
      const number = (name: string, fallback?: number) => {
        const parsed = new RegExp(`\\b${name}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(body);
        if (!parsed && fallback === undefined) visualError(found.file, lineOf(found.source, found.offset + (match.index ?? 0)), `AppElevation.${match[1]} layer has no ${name}`);
        return parsed ? Number(parsed[1]) : fallback!;
      };
      const offset = /offset\s*:\s*(?:const\s+)?Offset\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/.exec(body);
      if (!offset) visualError(found.file, lineOf(found.source, found.offset + (match.index ?? 0)), `AppElevation.${match[1]} layer has no numeric Offset`);
      const blur = /blurFromCss\s*\(\s*(\d+(?:\.\d+)?)\s*\)/.exec(body)?.[1] ?? /\bcssBlur\s*:\s*(\d+(?:\.\d+)?)/.exec(body)?.[1];
      if (!blur) visualError(found.file, lineOf(found.source, found.offset + (match.index ?? 0)), `AppElevation.${match[1]} layer must use blurFromCss(cssBlur)`);
      const colour = /color\s*:\s*AppColors\.(\w+)\.withValues\(\s*alpha\s*:\s*(\d+(?:\.\d+)?)\s*\)/.exec(body);
      if (!colour) visualError(found.file, lineOf(found.source, found.offset + (match.index ?? 0)), `AppElevation.${match[1]} layer must use an AppColors alpha composition`);
      return { dx: Number(offset[1]), dy: Number(offset[2]), cssBlur: Number(blur), spread: number('spreadRadius', 0), alpha: Number(colour[2]), colorIdentifier: colour[1] };
    });
    if (layers.length === 0) visualError(found.file, lineOf(found.source, found.offset + (match.index ?? 0)), `AppElevation.${match[1]} has no BoxShadow layers`);
    elevations.push({ identifier: match[1], layers, file: repoPath(found.file), line: lineOf(found.source, found.offset + (match.index ?? 0)) });
  }
  if (elevations.length === 0) throw new Error(`${repoPath(found.file)}: AppElevation has no parseable entries`);
  return elevations;
}

/** AppTint entries expressed as named token and explicit alpha compositions. */
export function dartTints(): DartTint[] {
  const found = readThemeClass('AppTint');
  const entries = /static\s+(?:const|final)\s+(?:AppTint|Tint)\s+(\w+)\s*=\s*(?:const\s+)?(?:AppTint|Tint)\s*\(/g;
  const tints: DartTint[] = [];
  for (const match of found.block.matchAll(entries)) {
    const block = parenBlock(found.block, match.index ?? 0);
    if (!block) visualError(found.file, lineOf(found.source, found.offset + (match.index ?? 0)), `AppTint.${match[1]} has an unbalanced argument list`);
    const body = block.slice(1, -1);
    const parsePart = (part: 'fill' | 'edge' | 'ink') => {
      const composed = new RegExp(`\\b${part}\\s*:\\s*AppColors\\.(\\w+)\\.withValues\\(\\s*alpha\\s*:\\s*(\\d+(?:\\.\\d+)?)\\s*\\)`).exec(body);
      if (composed) return { colorIdentifier: composed[1], alpha: Number(composed[2]) };
      // A part named without an alpha composition is the token at full opacity.
      const opaque = new RegExp(`\\b${part}\\s*:\\s*AppColors\\.(\\w+)\\s*(?:,|$)`).exec(body);
      return opaque ? { colorIdentifier: opaque[1], alpha: 1 } : null;
    };
    tints.push({ identifier: match[1], fill: parsePart('fill'), edge: parsePart('edge'), ink: parsePart('ink'), file: repoPath(found.file), line: lineOf(found.source, found.offset + (match.index ?? 0)) });
  }
  if (tints.length === 0) throw new Error(`${repoPath(found.file)}: AppTint has no parseable entries`);
  return tints;
}

function contrastPairList(listName: string, requireEntries: boolean): DartContrastPair[] {
  const found = readThemeClass('AppContrastPairs');
  const declaration = new RegExp(`\\b${listName}\\s*=\\s*(?:const\\s+)?<ContrastPair>\\s*\\[`).exec(found.block);
  if (!declaration || declaration.index === undefined) {
    throw new Error(`${repoPath(found.file)}: AppContrastPairs has no <ContrastPair> list named ${listName}`);
  }
  const listStart = declaration.index + declaration[0].length - 1;
  let depth = 0;
  let listEnd = -1;
  for (let i = listStart; i < found.block.length; i += 1) {
    if (found.block[i] === '[') depth += 1;
    else if (found.block[i] === ']') { depth -= 1; if (depth === 0) { listEnd = i; break; } }
  }
  if (listEnd === -1) visualError(found.file, lineOf(found.source, found.offset + listStart), `${listName} list is unbalanced`);
  const list = found.block.slice(listStart, listEnd);
  const entries = /ContrastPair\s*\(\s*fg\s*:\s*'([a-zA-Z]\w*)'\s*,\s*bg\s*:\s*'([a-zA-Z]\w*)'([^)]*)\)/g;
  const pairs = [...list.matchAll(entries)].map((match) => {
    const line = lineOf(found.source, found.offset + listStart + (match.index ?? 0));
    const level = /\blevel\s*:\s*'([a-zA-Z]\w*)'/.exec(match[3])?.[1] ?? null;
    const role = /\brole\s*:\s*PairRole\.(text|controlEdge|focus|stateGraphic)/.exec(match[3])?.[1] as DartContrastPair['role'] | undefined;
    if (!role) visualError(found.file, line, 'ContrastPair has no recognised role');
    return { fg: match[1], bg: match[2], level, role, file: repoPath(found.file), line };
  });
  if (requireEntries && pairs.length === 0) throw new Error(`${repoPath(found.file)}: AppContrastPairs.${listName} has no parseable pairs`);
  return pairs;
}

/** Every contrast pair AppContrastPairs declares as required to meet its floor. */
export function dartContrastPairs(): DartContrastPair[] {
  return contrastPairList('declaredPairs', true);
}

/**
 * The recorded exception list: pairs that miss their floor using the web's own values.
 * Legitimately empty, so it is the one list that does not have to be populated.
 */
export function dartContrastExceptions(): DartContrastPair[] {
  return contrastPairList('exceptions', false);
}

/** Each explicit ColorScheme slot, rejecting arbitrary expressions in later comparison. */
export function dartColorSchemeSlots(): DartSchemeSlot[] {
  const file = path.join(THEME_DIR, 'app_theme.dart');
  if (!existsSync(file)) throw new Error(`${repoPath(file)}: theme layer file is missing`);
  const source = readFileSync(file, 'utf8');
  const schemeAt = source.indexOf('ColorScheme(');
  if (schemeAt === -1) throw new Error(`${repoPath(file)}: ColorScheme constructor is missing`);
  const block = parenBlock(source, schemeAt);
  if (!block) visualError(file, lineOf(source, schemeAt), 'ColorScheme constructor is unbalanced');
  const slots = [...block.matchAll(/\b([a-z]\w*)\s*:\s*(?:AppColors\.(\w+)|([^,\n]+))/g)].map((match) => ({
    slot: match[1], colorIdentifier: match[2] ?? null, file: repoPath(file), line: lineOf(source, schemeAt + (match.index ?? 0)),
  }));
  if (slots.length === 0) visualError(file, lineOf(source, schemeAt), 'ColorScheme has no named slots');
  return slots;
}

/**
 * Transitional aliases marked by `MOBILE_THEME_ALIAS: old -> new` in the theme layer.
 *
 * An EMPTY result is the finished state, not a parse failure: Req 1.11 requires an
 * unreferenced alias to be deleted, so once the last one goes the whole marker set
 * legitimately disappears. That is why this is the one parser with no "read nothing"
 * guard — and why it takes an optional `fixture`, which the vacuous-pass canary uses
 * to prove the reader still reads. Given a fixture it DOES insist on finding a marker,
 * so the canary cannot pass by reading nothing either.
 */
export function dartMigrationAliases(fixture?: string): DartAlias[] {
  const aliases: DartAlias[] = [];
  for (const file of fixture ? [fixture] : themeFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/MOBILE_THEME_ALIAS:\s*(\w+)\s*->\s*(\w+)([^\n]*)/g)) {
      const identifier = match[1];
      const replacement = match[2];
      const recorded = /starting refs:\s*(\d+)/.exec(match[3]);
      if (!recorded) visualError(file, lineOf(source, match.index!), `MOBILE_THEME_ALIAS ${identifier} records no starting reference count`);
      const recordedCount = Number(recorded[1]);
      const hits = dartScopeFiles().flatMap((screen) => {
        const content = stripDartCommentsAndStrings(readFileSync(screen, 'utf8'));
        return [...content.matchAll(new RegExp(`\\b(?:AppTheme|AppColors|AppSpacing)\\.${identifier}\\b`, 'g'))];
      });
      aliases.push({ identifier, replacement, referenceCount: hits.length, recordedCount, file: repoPath(file), line: lineOf(source, match.index!) });
    }
  }
  if (fixture && aliases.length === 0) throw new Error(`${repoPath(fixture)} has no MOBILE_THEME_ALIAS markers`);
  return aliases;
}

function dartScopeFiles(): string[] {
  const files = MOBILE_SCREEN_DIRS.flatMap((directory) => existsSync(directory) ? walkDart(directory) : []);
  if (files.length === 0) throw new Error('flutter_app/lib/features and flutter_app/lib/widgets contain no Dart source files');
  return files;
}

/** Scans feature/widget call sites after erasing comments and string literals. */
export function dartCallSiteLiterals(kinds: LiteralKind[]): DartLiteralHit[] {
  const requested = new Set(kinds);
  const hits: DartLiteralHit[] = [];
  for (const file of dartScopeFiles()) {
    const source = readFileSync(file, 'utf8');
    const code = stripDartCommentsAndStrings(source);
    const add = (kind: LiteralKind, pattern: RegExp, valueAt?: (match: RegExpMatchArray) => number | null) => {
      if (!requested.has(kind)) return;
      for (const match of code.matchAll(pattern)) hits.push({ kind, text: source.slice(match.index!, match.index! + match[0].length), value: valueAt ? valueAt(match) : null, file: repoPath(file), line: lineOf(source, match.index!) });
    };
    add('fontSize', /\bfontSize\s*:\s*(-?\d+(?:\.\d+)?)(?![\w.])/g, (match) => Number(match[1]));
    add('iconSize', /\biconSize\s*:\s*(-?\d+(?:\.\d+)?)(?![\w.])/g, (match) => Number(match[1]));
    add('strokeWidth', /\bstrokeWidth\s*:\s*(-?\d+(?:\.\d+)?)(?![\w.])/g, (match) => Number(match[1]));
    add('shadowBlur', /\bblurRadius\s*:\s*(-?\d+(?:\.\d+)?)(?![\w.])/g, (match) => Number(match[1]));
    add('colorLiteral', /\bColor\s*\(\s*0x[0-9A-Fa-f]{6,8}\s*\)|\bColors\.(?!transparent\b)\w+|\bColor\.(?:fromARGB|fromRGBO)\s*\(/g);
    add('materialIcon', /\bIcons\.\w+/g);
    add('fontWeight', /\bFontWeight\.w(\d{3})/g, (match) => Number(match[1]));
    add('currencySymbol', /(?:Text|RichText)\s*\([^)]*[\$€£¥]/g);
    add('minorUnitDivisor', /\/(?:\s*)(?:100|100\.0|Math\.pow\(10\s*,\s*\d+\))/g);
    add('glyphName', /\b(?:HugeIconsStrokeRounded|Icons)\.\w+/g);
    add('navLevel', /\bAppType\.nav\b|\bAppTheme\.nav\b/g);
    add('textColor', /\b(?:Text|TextSpan)\s*\([\s\S]{0,500}?\b(?:color|style)\s*:\s*(?!AppText\.\w+|AppContrastPairs\.\w+)[^,\n)]+/g);

    if (requested.has('spacing')) {
      const spacingPatterns = [
        /\bEdgeInsets\.(?:all|symmetric|only|fromLTRB)\s*\(([\s\S]*?)\)/g,
        /\b(?:Padding|Margin)\s*\([\s\S]{0,160}?\b(?:left|right|top|bottom|horizontal|vertical)\s*:\s*(-?\d+(?:\.\d+)?)/g,
        /\b(?:SizedBox|Gap)\s*\([\s\S]{0,100}?\b(?:width|height)\s*:\s*(-?\d+(?:\.\d+)?)/g,
        /\b(?:spacing|runSpacing|left|right|top|bottom)\s*:\s*(-?\d+(?:\.\d+)?)(?![\w.])/g,
      ];
      for (const pattern of spacingPatterns) {
        for (const match of code.matchAll(pattern)) {
          const numbers = [...match[0].matchAll(/(?:^|[:,\s])(-?\d+(?:\.\d+)?)(?![\w.])/g)];
          for (const number of numbers) hits.push({ kind: 'spacing', text: number[0].trim(), value: Number(number[1]), file: repoPath(file), line: lineOf(source, (match.index ?? 0) + (number.index ?? 0)) });
        }
      }
    }
  }
  return hits;
}

/** Parses the dedicated IconMap and returns its documented substitutions. */
export function dartIconMap(): IconMapEntry[] {
  const file = path.join(FLUTTER_LIB_DIR, 'core', 'icons.dart');
  if (!existsSync(file)) throw new Error(`${repoPath(file)}: icon map is missing`);
  const source = readFileSync(file, 'utf8');
  const entries = [...source.matchAll(/IconEntry\s*\(\s*web\s*:\s*'([A-Za-z0-9]+Icon)'\s*,\s*flutter\s*:\s*([A-Za-z0-9_.]+)(?:\s*,\s*reason\s*:\s*'([^']+)')?\s*\)/g)].map((match) => ({ web: match[1], flutter: match[2], reason: match[3] ?? null, file: repoPath(file), line: lineOf(source, match.index!) }));
  if (entries.length === 0) throw new Error(`${repoPath(file)}: IconMap has no parseable IconEntry values`);
  return entries;
}

// ─── Typeface delivery (Req 12.5–12.6, 12.10; Property P11) ──────────────────
//
// A missing font face is the one visual defect Flutter will not report. An
// unresolvable `family:` falls back to the platform face and an unbundled `weight:`
// is SYNTHESISED from the nearest bundled one, so both render text that looks
// approximately right and neither raises anything. That is why these parsers read
// `pubspec.yaml` and the Dart tree against each other rather than trusting either.

const FLUTTER_PUBSPEC = path.join(REPO_ROOT, 'flutter_app', 'pubspec.yaml');

export interface BundledFontFace extends SourceRef {
  asset: string;
  weight: number | null;
  style: string | null;
  /** True when the asset the face names exists on disk. */
  assetExists: boolean;
}

export interface BundledFontFamily extends SourceRef {
  family: string;
  faces: BundledFontFace[];
}

export interface DartFontFamilyReference extends SourceRef {
  /** The right-hand side as written, e.g. `AppType.family` or `'Courier'`. */
  text: string;
}

export interface DartFontWeightUse extends SourceRef {
  /** As written, e.g. `FontWeight.w600`. */
  text: string;
  /** The numeric weight it resolves to, or null for a name this parser cannot resolve. */
  weight: number | null;
}

/** Flutter's named weights, so `FontWeight.bold` is read as 700 rather than skipped. */
const NAMED_FONT_WEIGHTS: Record<string, number> = {
  normal: 400, bold: 700,
  w100: 100, w200: 200, w300: 300, w400: 400, w500: 500,
  w600: 600, w700: 700, w800: 800, w900: 900,
};

/**
 * Reads the `flutter: fonts:` block of `flutter_app/pubspec.yaml`.
 *
 * Indentation-driven rather than a YAML dependency, and strict about it: an
 * unrecognised line inside the block throws instead of being skipped, because a
 * face this parser silently dropped is a face the agreement then cannot miss.
 */
export function bundledFontFamilies(pubspec = FLUTTER_PUBSPEC): BundledFontFamily[] {
  const source = readFileSync(pubspec, 'utf8');
  const lines = source.split(/\r?\n/);
  const flutterAt = lines.findIndex((line) => /^flutter:\s*$/.test(line));
  if (flutterAt === -1) visualError(pubspec, 1, 'pubspec.yaml declares no top-level `flutter:` section');

  let fontsAt = -1;
  for (let i = flutterAt + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // left the `flutter:` block
    if (/^\s{2}fonts:\s*$/.test(line)) { fontsAt = i; break; }
  }
  if (fontsAt === -1) return [];

  const families: BundledFontFamily[] = [];
  for (let i = fontsAt + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.trim() === '' || /^\s*#/.test(raw)) continue;
    if (/^\S/.test(raw)) break;
    const indent = raw.length - raw.trimStart().length;
    if (indent <= 2) break; // a sibling key of `fonts:` inside `flutter:`

    const family = /^\s*-\s*family:\s*(.+?)\s*$/.exec(raw);
    if (family) {
      families.push({ family: family[1].replace(/^['"]|['"]$/g, ''), faces: [], file: repoPath(pubspec), line: i + 1 });
      continue;
    }
    if (/^\s*fonts:\s*$/.test(raw)) continue;
    const asset = /^\s*-\s*asset:\s*(.+?)\s*$/.exec(raw);
    if (asset) {
      const current = families.at(-1);
      if (!current) visualError(pubspec, i + 1, 'a font asset appears before any `- family:`');
      const value = asset[1].replace(/^['"]|['"]$/g, '');
      current.faces.push({
        asset: value,
        weight: null,
        style: null,
        assetExists: existsSync(path.join(path.dirname(pubspec), ...value.split('/'))),
        file: repoPath(pubspec),
        line: i + 1,
      });
      continue;
    }
    const weight = /^\s*weight:\s*(\d+)\s*$/.exec(raw);
    const style = /^\s*style:\s*(\w+)\s*$/.exec(raw);
    if (weight || style) {
      const face = families.at(-1)?.faces.at(-1);
      if (!face) visualError(pubspec, i + 1, 'a font face attribute appears before any `- asset:`');
      if (weight) face.weight = Number(weight[1]);
      if (style) face.style = style[1];
      continue;
    }
    visualError(pubspec, i + 1, `unrecognised line inside the \`flutter: fonts:\` block: ${raw.trim()}`);
  }
  return families;
}

/** Every dependency name `flutter_app/pubspec.yaml` declares, dev dependencies included. */
export function pubspecDependencyNames(pubspec = FLUTTER_PUBSPEC): string[] {
  const lines = readFileSync(pubspec, 'utf8').split(/\r?\n/);
  const names: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (/^(dev_)?dependencies:\s*$/.test(line)) { inBlock = true; continue; }
    if (/^\S/.test(line) && line.trim() !== '') { inBlock = false; continue; }
    if (!inBlock) continue;
    const entry = /^\s{2}([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    if (entry) names.push(entry[1]);
  }
  if (names.length === 0) visualError(pubspec, 1, 'pubspec.yaml declares no dependencies');
  return names;
}

/** Every `fontFamily:` / `fontFamilyFallback:` assignment anywhere under `flutter_app/lib`. */
export function dartFontFamilyReferences(): DartFontFamilyReference[] {
  const references: DartFontFamilyReference[] = [];
  for (const file of walkDart(FLUTTER_LIB_DIR)) {
    const source = readFileSync(file, 'utf8');
    const code = stripDartCommentsAndStrings(source);
    // Strings are erased by the stripper, so a literal family reads as blank quotes;
    // the ORIGINAL source is sliced for the report so the offender is legible.
    for (const match of code.matchAll(/\bfontFamily(?:Fallback)?\s*:\s*[^,\n)]+/g)) {
      references.push({
        text: source.slice(match.index!, match.index! + match[0].length).trim(),
        file: repoPath(file), line: lineOf(source, match.index!),
      });
    }
  }
  return references;
}

/** Every `FontWeight.…` applied anywhere under `flutter_app/lib`, named weights resolved. */
export function dartAppliedFontWeights(): DartFontWeightUse[] {
  const uses: DartFontWeightUse[] = [];
  for (const file of walkDart(FLUTTER_LIB_DIR)) {
    const source = readFileSync(file, 'utf8');
    const code = stripDartCommentsAndStrings(source);
    for (const match of code.matchAll(/\bFontWeight\.(\w+)\b/g)) {
      const named = NAMED_FONT_WEIGHTS[match[1]];
      uses.push({
        text: match[0],
        weight: named ?? null,
        file: repoPath(file), line: lineOf(source, match.index!),
      });
    }
  }
  return uses;
}

/** The single family name the Dart theme declares, read from `AppType.family`. */
export function dartFontFamilyConstant(): { family: string } & SourceRef {
  const found = readThemeClass('AppType');
  const match = /static\s+const\s+String\s+family\s*=\s*'([^']+)'\s*;/.exec(found.block);
  if (!match) visualError(found.file, lineOf(found.source, found.offset), 'AppType declares no `static const String family`');
  return { family: match[1], file: repoPath(found.file), line: lineOf(found.source, found.offset + found.block.indexOf(match[0])) };
}

/** Standard CSS HSL to opaque ARGB conversion. */
export function hslToArgb([h, s, l]: [number, number, number]): number {
  const hue = ((((h % 360) + 360) % 360) / 360);
  const saturation = s / 100;
  const lightness = l / 100;
  if (saturation === 0) {
    const value = Math.round(lightness * 255);
    return (0xff000000 | (value << 16) | (value << 8) | value) >>> 0;
  }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (t: number): number => {
    const adjusted = (t + 1) % 1;
    if (6 * adjusted < 1) return p + (q - p) * 6 * adjusted;
    if (2 * adjusted < 1) return q;
    if (3 * adjusted < 2) return p + (q - p) * (2 / 3 - adjusted) * 6;
    return p;
  };
  const red = Math.round(channel(hue + 1 / 3) * 255);
  const green = Math.round(channel(hue) * 255);
  const blue = Math.round(channel(hue - 1 / 3) * 255);
  return (0xff000000 | (red << 16) | (green << 8) | blue) >>> 0;
}

/** Inverse of hslToArgb, used only by the round-trip property tests. */
export function argbToHsl(argb: number): [number, number, number] {
  const red = ((argb >>> 16) & 0xff) / 255;
  const green = ((argb >>> 8) & 0xff) / 255;
  const blue = (argb & 0xff) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness * 100];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0) : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  hue *= 60;
  return [hue, saturation * 100, lightness * 100];
}

/** WCAG relative luminance for an ARGB colour. */
export function relativeLuminance(argb: number): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear((argb >>> 16) & 0xff) + 0.7152 * linear((argb >>> 8) & 0xff) + 0.0722 * linear(argb & 0xff);
}

/** WCAG contrast ratio, symmetric and bounded from 1 to 21. */
export function contrastRatio(a: number, b: number): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function finding(kind: TokenFinding['kind'], token: string, webValue: string | null, dartValue: string | null, web: SourceRef | null, dart: SourceRef | null, criterion: string, detail: string): TokenFinding {
  return { kind, token, webValue, dartValue, web, dart, criterion, detail };
}

// Generic over each side INDEPENDENTLY: the web and Dart shapes are deliberately
// different (web carries `lineHeight`/`px`, Dart carries `height`/`value`), so one
// type parameter for both would infer an impossible intersection and collapse the
// callers' `in` narrowing to `never`.
function compareNamed<W extends SourceRef, D extends SourceRef>(web: W[], dart: D[], key: (item: W | D) => string, value: (item: W | D) => string, criterion: string): TokenFinding[] {
  const findings: TokenFinding[] = [];
  const webByKey = new Map(web.map((item) => [key(item), item]));
  const dartByKey = new Map(dart.map((item) => [key(item), item]));
  for (const [token, entry] of webByKey) {
    const counterpart = dartByKey.get(token);
    if (!counterpart) findings.push(finding('missing-in-dart', token, value(entry), null, entry, null, criterion, 'web token has no Dart counterpart'));
    else if (value(entry) !== value(counterpart)) findings.push(finding('value-differs', token, value(entry), value(counterpart), entry, counterpart, criterion, 'token values differ'));
  }
  for (const [token, entry] of dartByKey) if (!webByKey.has(token)) findings.push(finding('missing-in-web', token, null, value(entry), null, entry, criterion, 'Dart token has no web counterpart'));
  return findings;
}

/** Bidirectional palette comparison with a one-channel ARGB tolerance. */
export function comparePalette(web: WebColorToken[], dart: DartColorConst[]): TokenFinding[] {
  const findings: TokenFinding[] = [];
  const dartByName = new Map(dart.map((entry) => [entry.identifier, entry]));
  for (const token of web) {
    const entry = dartByName.get(token.camel);
    const expected = hslToArgb(token.hsl);
    if (!entry) findings.push(finding('missing-in-dart', token.token, `0x${expected.toString(16)}`, null, token, null, 'Req 1.2', 'web colour has no Dart constant'));
    else {
      const diffs = [24, 16, 8].map((shift) => Math.abs(((expected >>> shift) & 0xff) - ((entry.argb >>> shift) & 0xff)));
      if (diffs.some((difference) => difference > 1)) findings.push(finding('value-differs', token.token, `0x${expected.toString(16)}`, `0x${entry.argb.toString(16)}`, token, entry, 'Req 1.2', `RGB channel differences ${diffs.join(', ')}`));
    }
  }
  const webNames = new Set(web.map((entry) => entry.camel));
  for (const entry of dart) if (!webNames.has(entry.identifier) && !entry.aliasTarget) findings.push(finding('missing-in-web', entry.identifier, null, `0x${entry.argb.toString(16)}`, null, entry, 'Req 1.4', 'Dart colour constant has no web token'));
  return findings;
}

export function compareTypeScale(web: WebTypeLevel[], dart: DartTypeLevel[]): TokenFinding[] {
  const webComparable = web.map((entry) => ({ ...entry, identifier: entry.token }));
  return compareNamed(webComparable, dart, (entry) => entry.identifier, (entry) => `${entry.px}/${'lineHeight' in entry ? entry.lineHeight : entry.height}`, 'Req 2.3');
}

export function compareSpacing(web: WebLength[], dart: DartNumeric[]): TokenFinding[] {
  const webComparable = web.map((entry) => ({ ...entry, identifier: entry.token }));
  return compareNamed(webComparable, dart, (entry) => entry.identifier, (entry) => `${'px' in entry ? entry.px : entry.value}`, 'Req 3.2');
}

/** Compare sm/md/lg to values derived from the actual CSS --radius root declaration. */
export function compareRadius(web: WebLength[], radiusBase: WebLength, dart: DartNumeric[]): TokenFinding[] {
  const expected = new Map([['sm', radiusBase.px - 4], ['md', radiusBase.px - 2], ['lg', radiusBase.px]]);
  const derived = web.filter((entry) => expected.has(entry.token));
  const findings = compareSpacing(derived, dart.filter((entry) => entry.identifier !== 'full'));
  for (const [token, value] of expected) {
    const entry = derived.find((candidate) => candidate.token === token);
    if (!entry || entry.px !== value) findings.push(finding('value-differs', token, String(value), entry ? String(entry.px) : null, radiusBase, entry ?? null, 'Req 3.6', 'Tailwind radius does not derive from --radius'));
  }
  for (const entry of dart.filter((candidate) => candidate.identifier === 'full')) if (entry.value < 999) findings.push(finding('value-differs', 'full', '>=999', String(entry.value), null, entry, 'Req 3.7', 'full radius must be at least 999'));
  return findings;
}

/**
 * Compare shadows layer for layer in the CSS blur convention.
 *
 * Both sides are reduced to one normal form first: the Dart side names its blur
 * `cssBlur` and its colour by Dart identifier, the web side names them `blur` and
 * `--token`. Comparing the raw shapes would differ on every key name and pass nothing.
 */
export function compareElevation(web: WebShadowToken[], dart: DartShadow[]): TokenFinding[] {
  interface NormalShadow extends SourceRef { token: string; normal: string }
  const normalWeb: NormalShadow[] = web.map((entry) => ({
    token: entry.token, file: entry.file, line: entry.line,
    normal: JSON.stringify(entry.layers.map((layer) => [layer.dx, layer.dy, layer.blur, layer.spread, layer.alpha, cssVariableCamel(layer.colorToken)])),
  }));
  const normalDart: NormalShadow[] = dart.map((entry) => ({
    token: entry.identifier, file: entry.file, line: entry.line,
    normal: JSON.stringify(entry.layers.map((layer) => [layer.dx, layer.dy, layer.cssBlur, layer.spread, layer.alpha, layer.colorIdentifier])),
  }));
  return compareNamed(normalWeb, normalDart, (entry) => entry.token, (entry) => entry.normal, 'Req 3.8');
}

/** Ensures every role's numeric size/height resolves to exactly one type level. */
export function resolveRoleLevels(levels: DartTypeLevel[], roles: DartTextRole[]): TokenFinding[] {
  const findings: TokenFinding[] = [];
  for (const role of roles) {
    const matches = levels.filter((level) => level.px === role.px);
    if (matches.length !== 1) findings.push(finding('unparsed', role.identifier, null, `${role.px}/${role.height}`, null, role, 'Req 2.6', `role size matches ${matches.length} type levels`));
    else if (matches[0].height !== role.height) findings.push(finding('value-differs', role.identifier, `${matches[0].px}/${matches[0].height}`, `${role.px}/${role.height}`, matches[0], role, 'Req 2.6', 'role height differs from its matching type level'));
  }
  return findings;
}

// ─── Hub_Set: the shell's route table ──────────────────────────────────────────
//
// Added for Property 23, which is the one property that can compare the two
// implementations of a rule DIRECTLY: `flutter_app/lib/router/hub_set.dart` is a
// hand port of `components/layout/marketplace-nav-config.ts`, and the web helper
// it ports has four special cases whose boundaries are where a re-implementation
// goes wrong.
//
// These parsers read the Dart side only. The web side is IMPORTED by the test
// rather than parsed, because it is TypeScript the test can simply call — parsing
// a module you could execute is a second implementation of it.

/** A path constant declared in `AppRoutes`. */
export interface DartRouteConstant extends SourceRef {
  identifier: string;
  path: string;
}

/** A `GoRoute(path: '…')` literal from the Flutter route table. */
export interface DartGoRoute extends SourceRef {
  path: string;
}

/** One row of a Hub_Set entry's destination list. */
export interface DartHubDestination {
  path: string;
  label: string;
}

/** A Hub_Set entry as `hub_set.dart` declares it. */
export interface DartMobileHub extends SourceRef {
  id: string;
  label: string;
  kind: 'link' | 'sheet';
  requiresAuth: boolean;
  destinations: DartHubDestination[];
  ownedSections: string[];
  sheetTitle: string | null;
  sheetDescription: string | null;
}

const ROUTER_FILE = path.join(FLUTTER_LIB_DIR, 'router', 'router.dart');
const HUB_SET_FILE = path.join(FLUTTER_LIB_DIR, 'router', 'hub_set.dart');

/**
 * Erase Dart comments while KEEPING string literals.
 *
 * `stripDartCommentsAndStrings` erases both, which is right for a colour-literal
 * scan and wrong here: a hub's label and a route's path ARE string literals, so
 * erasing them leaves nothing to read. Comment text still has to go — the hub
 * table's own comments quote route paths and hub labels in prose.
 *
 * Every erased character is replaced by a space so byte offsets, and therefore
 * reported line numbers, survive.
 */
function eraseDartComments(source: string, file: string): string {
  let result = '';
  let index = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' = 'code';
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') { state = 'line'; result += '  '; index += 2; continue; }
      if (char === '/' && next === '*') { state = 'block'; result += '  '; index += 2; continue; }
      if (char === "'") state = 'single';
      else if (char === '"') state = 'double';
      result += char;
    } else if (state === 'line') {
      if (char === '\n') { state = 'code'; result += '\n'; } else result += ' ';
    } else if (state === 'block') {
      if (char === '*' && next === '/') { state = 'code'; result += '  '; index += 2; continue; }
      result += char === '\n' ? '\n' : ' ';
    } else {
      const quote = state === 'single' ? "'" : '"';
      if (char === '\\') { result += source.slice(index, index + 2); index += 2; continue; }
      if (char === quote) state = 'code';
      result += char;
    }
    index += 1;
  }
  if (state !== 'code') visualError(file, lineOf(source, index), `unterminated ${state} section`);
  return result;
}

/**
 * Replace every string literal's interior with `x`, preserving length.
 *
 * Length-preserving because the caller reads structure off the masked copy and
 * slices values out of the original at the same indices.
 */
function maskDartStringLiterals(source: string): string {
  let result = '';
  let index = 0;
  let state: 'code' | 'single' | 'double' = 'code';
  while (index < source.length) {
    const char = source[index];
    if (state === 'code') {
      if (char === "'") state = 'single';
      else if (char === '"') state = 'double';
      result += char;
    } else {
      const quote = state === 'single' ? "'" : '"';
      if (char === '\\') { result += 'xx'; index += 2; continue; }
      if (char === quote) { state = 'code'; result += char; } else result += char === '\n' ? '\n' : 'x';
    }
    index += 1;
  }
  return result;
}

/** Extract the bracketed list at or after `from`, balanced across nesting. */
function bracketBlock(source: string, from: number): string | null {
  const open = source.indexOf('[', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '[') depth += 1;
    else if (source[i] === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

/** Every `AppRoutes` path constant, so a hub's sections can be resolved to paths. */
export function dartRouteConstants(routerFile = ROUTER_FILE): DartRouteConstant[] {
  const raw = readFileSync(routerFile, 'utf8');
  const source = eraseDartComments(raw, routerFile);
  const declared = /abstract\s+final\s+class\s+AppRoutes\s*\{/.exec(source);
  if (!declared || declared.index === undefined) {
    visualError(routerFile, 1, 'router.dart declares no abstract final class AppRoutes');
  }
  const block = braceBlock(source, declared.index + declared[0].length - 1);
  if (!block) visualError(routerFile, lineOf(source, declared.index), 'unbalanced AppRoutes class body');

  const constants: DartRouteConstant[] = [];
  // Every member must reduce to a literal path. A computed or interpolated route
  // constant is thrown on rather than recorded as null, because a hub whose
  // section resolved to null would compare equal to nothing and pass (Req 15.2).
  for (const member of block.matchAll(/static\s+const\s+(\w+)\s*=\s*([^;]+);/g)) {
    const line = lineOf(source, declared.index + (member.index ?? 0));
    const literal = member[2].trim().match(/^'(\/[^'$]*)'$/);
    if (!literal) {
      visualError(routerFile, line, `AppRoutes.${member[1]} is not a literal path: ${member[2].trim()}`);
    }
    constants.push({ identifier: member[1], path: literal[1], file: repoPath(routerFile), line });
  }
  if (constants.length === 0) {
    visualError(routerFile, lineOf(source, declared.index), 'AppRoutes has no parseable path constants');
  }
  return constants;
}

/** Every route the Flutter router serves, as its `path:` literal states it. */
export function dartGoRoutePaths(routerFile = ROUTER_FILE): DartGoRoute[] {
  const raw = readFileSync(routerFile, 'utf8');
  const source = eraseDartComments(raw, routerFile);
  const byIdentifier = new Map(dartRouteConstants(routerFile).map((entry) => [entry.identifier, entry.path]));

  const routes: DartGoRoute[] = [];
  for (const match of source.matchAll(/GoRoute\(\s*path:\s*([^,]+),/g)) {
    const line = lineOf(source, match.index ?? 0);
    const raw = match[1].trim();
    const literal = raw.match(/^'(\/[^'$]*)'$/);
    const constant = raw.match(/^AppRoutes\.(\w+)$/);
    const resolved = literal ? literal[1] : constant ? byIdentifier.get(constant[1]) : undefined;
    if (resolved === undefined) visualError(routerFile, line, `GoRoute path is not a resolvable literal: ${raw}`);
    routes.push({ path: resolved, file: repoPath(routerFile), line });
  }
  if (routes.length === 0) visualError(routerFile, 1, 'router.dart declares no GoRoute paths');
  return routes;
}

/**
 * The value of the named argument at the argument list's OWN nesting depth.
 *
 * Depth-aware rather than a first-match regex: every hub declares a `label:` and
 * so does every `HubDestination` inside it, and a nested match read as the hub's
 * own would pass while comparing the wrong pair of strings.
 */
function hubArgument(body: string, name: string): string | null {
  const opens = '([<{';
  const closes = ')]>}';
  // Structure is read off a masked copy and values are sliced out of the original.
  // The mask preserves length, so the indices are the same in both — and a comma
  // inside a member-facing string ('Your purchases, sales and trades.') can no
  // longer be read as the end of that argument.
  const masked = maskDartStringLiterals(body);
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = masked[i];
    if (opens.includes(char)) { depth += 1; continue; }
    if (closes.includes(char)) { depth -= 1; continue; }
    if (depth !== 0) continue;
    // A candidate must start on a word boundary, so `sheetTitle` cannot be found
    // by a search for `title`.
    if (!masked.startsWith(name, i)) continue;
    if (i > 0 && /[A-Za-z0-9_$]/.test(masked[i - 1])) continue;
    const after = masked.slice(i + name.length).match(/^\s*:/);
    if (!after) continue;

    const from = i + name.length + after[0].length;
    let valueDepth = 0;
    for (let j = from; j < body.length; j += 1) {
      const inner = masked[j];
      if (opens.includes(inner)) valueDepth += 1;
      else if (closes.includes(inner)) valueDepth -= 1;
      else if (inner === ',' && valueDepth === 0) return body.slice(from, j).trim();
    }
    return body.slice(from).trim();
  }
  return null;
}

function hubStringArgument(body: string, name: string, file: string, line: number, required: boolean): string | null {
  const raw = hubArgument(body, name);
  if (raw === null) {
    if (required) visualError(file, line, `Hub_Set entry has no ${name}`);
    return null;
  }
  const literal = raw.match(/^'([^'$]*)'$/);
  if (!literal) visualError(file, line, `Hub_Set ${name} is not a plain string literal: ${raw}`);
  return literal[1];
}

/**
 * The Hub_Set as `hub_set.dart` declares it, in declaration order.
 *
 * Order is part of the contract (Req 4.5 fixes the five destinations
 * left-to-right), so the list is never sorted.
 */
export function dartMobileHubs(hubFile = HUB_SET_FILE, routerFile = ROUTER_FILE): DartMobileHub[] {
  const raw = readFileSync(hubFile, 'utf8');
  const source = eraseDartComments(raw, hubFile);
  const byIdentifier = new Map(dartRouteConstants(routerFile).map((entry) => [entry.identifier, entry.path]));

  const declared = /const\s+List<MobileHub>\s+kMobileHubs\s*=/.exec(source);
  if (!declared || declared.index === undefined) {
    visualError(hubFile, 1, 'hub_set.dart declares no const List<MobileHub> kMobileHubs');
  }
  const table = bracketBlock(source, declared.index);
  if (!table) visualError(hubFile, lineOf(source, declared.index), 'unbalanced kMobileHubs list');
  const tableStart = source.indexOf(table, declared.index);

  const resolvePath = (raw: string, line: number): string => {
    const literal = raw.match(/^'(\/[^'$]*)'$/);
    if (literal) return literal[1];
    const constant = raw.match(/^AppRoutes\.(\w+)$/);
    const resolved = constant ? byIdentifier.get(constant[1]) : undefined;
    if (resolved === undefined) visualError(hubFile, line, `cannot resolve route reference ${raw}`);
    return resolved;
  };

  const hubs: DartMobileHub[] = [];
  for (const entry of table.matchAll(/MobileHub\(/g)) {
    const at = tableStart + (entry.index ?? 0);
    const line = lineOf(source, at);
    const args = parenBlock(source, at + 'MobileHub'.length);
    if (!args) visualError(hubFile, line, 'unbalanced MobileHub argument list');
    const body = args.slice(1, -1);

    const idRaw = hubArgument(body, 'id');
    const idMatch = idRaw?.match(/^MobileHubId\.(\w+)$/);
    if (!idMatch) visualError(hubFile, line, `Hub_Set entry has no MobileHubId: ${idRaw ?? 'absent'}`);

    const kindRaw = hubArgument(body, 'kind');
    const kindMatch = kindRaw?.match(/^MobileHubKind\.(link|sheet)$/);
    if (!kindMatch) visualError(hubFile, line, `Hub_Set entry has no MobileHubKind: ${kindRaw ?? 'absent'}`);

    const authRaw = hubArgument(body, 'requiresAuth');
    if (authRaw !== 'true' && authRaw !== 'false') {
      visualError(hubFile, line, `Hub_Set requiresAuth is not a boolean literal: ${authRaw ?? 'absent'}`);
    }

    const destinationsRaw = hubArgument(body, 'destinations');
    if (destinationsRaw === null) visualError(hubFile, line, 'Hub_Set entry declares no destinations');
    const destinations: DartHubDestination[] = [];
    for (const row of destinationsRaw.matchAll(/HubDestination\(/g)) {
      const rowArgs = parenBlock(destinationsRaw, (row.index ?? 0) + 'HubDestination'.length);
      if (!rowArgs) visualError(hubFile, line, 'unbalanced HubDestination argument list');
      const rowBody = rowArgs.slice(1, -1);
      const pathRaw = hubArgument(rowBody, 'path');
      if (pathRaw === null) visualError(hubFile, line, 'HubDestination declares no path');
      destinations.push({
        path: resolvePath(pathRaw, line),
        label: hubStringArgument(rowBody, 'label', hubFile, line, true)!,
      });
    }
    if (destinations.length === 0) visualError(hubFile, line, 'Hub_Set entry has an empty destination list');

    const sectionsRaw = hubArgument(body, 'ownedSections');
    if (sectionsRaw === null) visualError(hubFile, line, 'Hub_Set entry declares no ownedSections');
    const sectionList = bracketBlock(sectionsRaw, 0);
    if (!sectionList) visualError(hubFile, line, `ownedSections is not a list: ${sectionsRaw}`);
    const ownedSections = sectionList
      .slice(1, -1)
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .map((token) => resolvePath(token, line));
    if (ownedSections.length === 0) visualError(hubFile, line, 'Hub_Set entry owns no sections');

    hubs.push({
      id: idMatch[1],
      label: hubStringArgument(body, 'label', hubFile, line, true)!,
      kind: kindMatch[1] as 'link' | 'sheet',
      requiresAuth: authRaw === 'true',
      destinations,
      ownedSections,
      sheetTitle: hubStringArgument(body, 'sheetTitle', hubFile, line, false),
      sheetDescription: hubStringArgument(body, 'sheetDescription', hubFile, line, false),
      file: repoPath(hubFile),
      line,
    });
  }
  if (hubs.length === 0) visualError(hubFile, lineOf(source, declared.index), 'kMobileHubs is empty');
  return hubs;
}

/**
 * The section paths `isHubSectionActive` special-cases before its generic rule.
 *
 * The web helper carries four such cases and their boundaries are the whole
 * difficulty of the port, so the Dart port having the SAME set is asserted
 * structurally rather than inferred from a handful of sampled routes.
 */
export function dartHubSectionSpecialCases(hubFile = HUB_SET_FILE, routerFile = ROUTER_FILE): string[] {
  const raw = readFileSync(hubFile, 'utf8');
  const source = eraseDartComments(raw, hubFile);
  const byIdentifier = new Map(dartRouteConstants(routerFile).map((entry) => [entry.identifier, entry.path]));

  const declared = /bool\s+isHubSectionActive\s*\(/.exec(source);
  if (!declared || declared.index === undefined) {
    visualError(hubFile, 1, 'hub_set.dart declares no isHubSectionActive');
  }
  const body = braceBlock(source, declared.index);
  if (!body) visualError(hubFile, lineOf(source, declared.index), 'unbalanced isHubSectionActive body');

  const cases: string[] = [];
  for (const match of body.matchAll(/section\s*==\s*(AppRoutes\.(\w+)|'(\/[^'$]*)')/g)) {
    const line = lineOf(source, declared.index + (match.index ?? 0));
    const resolved = match[2] ? byIdentifier.get(match[2]) : match[3];
    if (resolved === undefined) visualError(hubFile, line, `cannot resolve special-cased section ${match[1]}`);
    if (!cases.includes(resolved)) cases.push(resolved);
  }
  if (cases.length === 0) {
    visualError(hubFile, lineOf(source, declared.index), 'isHubSectionActive special-cases no section');
  }
  return cases;
}

// ─── Scope boundary (Req 14) ─────────────────────────────────────────────────
//
// These parsers answer the question "is this still a presentation change?"
// mechanically. They sit here rather than in the visual-parity block above
// because they read the SAME Dart tree for a different reason: not whether a
// value agrees with the web, but whether a rule crossed the language boundary
// that was not supposed to.
//
// The `mobile-visual-parity` design records the resolution of its own scope
// conflict (task 6.1): the contract-room step-plan derivation belongs to
// `.kiro/specs/mobile-parity/` Requirement 11, and this spec keeps only
// presentation. A guard that names the ninth port, the surplus symbol and the
// retired word is what stops that resolution from decaying into a comment.

/** The Advisory_Domain_Port census: a hand-written rule module and its pinned TypeScript. */
export interface DartAdvisoryPort {
  /** Repo-relative Dart path. */
  file: string;
  /** Repo-relative TypeScript module or directory the port's header declares it mirrors. */
  mirrors: string;
}

const ADVISORY_PORT_DIR = path.join(FLUTTER_LIB_DIR, 'domain');
const MONEY_PORT = path.join(FLUTTER_LIB_DIR, 'core', 'money.dart');

/**
 * Every hand-written Advisory_Domain_Port, with the TypeScript module it declares.
 *
 * Req 14.1 counts these. `domain/generated/**` is excluded because a generated file
 * is a transform of the TypeScript rather than a second copy of a rule — the whole
 * point of generating it — and `walkDart` already drops `*.g.dart`.
 *
 * The mirror is READ OFF the port's own header (`Mirrors \`path\``) rather than held
 * in a map here. A map would be a third place the pairing lives, and the pairing is
 * the thing being asserted.
 */
export function dartAdvisoryPorts(): DartAdvisoryPort[] {
  if (!existsSync(ADVISORY_PORT_DIR)) throw new Error('flutter_app/lib/domain is missing entirely');
  if (!existsSync(MONEY_PORT)) throw new Error('flutter_app/lib/core/money.dart is missing');

  const files = [...walkDart(ADVISORY_PORT_DIR), MONEY_PORT]
    .filter((file) => !repoPath(file).includes('/domain/generated/'));
  if (files.length === 0) throw new Error('flutter_app/lib/domain contains no hand-written Dart source');

  return files.sort().map((file) => {
    const source = readFileSync(file, 'utf8');
    const declared = /^\s*\/\/\/\s*Mirrors\s+`([^`]+)`/m.exec(source);
    if (!declared) {
      visualError(file, 1, 'Advisory_Domain_Port declares no "Mirrors `path`" header, so nothing pins it to the TypeScript');
    }
    const mirrors = declared[1].replace(/\/+$/, '');
    if (!existsSync(path.join(REPO_ROOT, mirrors))) {
      visualError(file, lineOf(source, declared.index!), `mirrors ${mirrors}, which does not exist`);
    }
    return { file: repoPath(file), mirrors };
  });
}

/** Library-level public declarations of a Dart source file. */
function dartTopLevelPublicSymbols(source: string): string[] {
  const code = stripDartCommentsAndStrings(source);
  const symbols = new Set<string>();
  const declaration = /^(?:abstract\s+|final\s+|sealed\s+|base\s+|interface\s+|mixin\s+)*(?:class|enum|mixin|extension|typedef)\s+([A-Za-z_]\w*)/gm;
  for (const match of code.matchAll(declaration)) symbols.add(match[1]);
  for (const match of code.matchAll(/^(?:const|final)\s+(?:[\w<>,\s?[\]]+\s+)?([a-z]\w*)\s*=/gm)) symbols.add(match[1]);
  for (const match of code.matchAll(/^[A-Za-z_][\w<>,\s?[\].]*\s+([a-z]\w*)\s*\(/gm)) symbols.add(match[1]);
  return [...symbols].filter((symbol) => !symbol.startsWith('_')).sort();
}

/** Every identifier a TypeScript module and the modules it imports declare or mention. */
function tsIdentifierVocabulary(target: string): Set<string> {
  const absolute = path.join(REPO_ROOT, target);
  const seeds = statSync(absolute).isDirectory()
    ? readdirSync(absolute).filter((entry) => entry.endsWith('.ts')).map((entry) => path.join(absolute, entry))
    : [absolute];

  // One import hop. `isTerminal` lives in `state-machine/types.ts` and is re-exported
  // through `machine.ts`'s own imports; refusing the hop would report a faithful port
  // as surplus, which is the failure mode that gets a guard switched off.
  const files = new Set(seeds);
  for (const seed of seeds) {
    for (const match of readFileSync(seed, 'utf8').matchAll(/from\s+'([^']+)'/g)) {
      const specifier = match[1];
      const base = specifier.startsWith('@/')
        ? path.join(REPO_ROOT, specifier.slice(2))
        : specifier.startsWith('.') ? path.join(path.dirname(seed), specifier) : null;
      if (base === null) continue;
      for (const candidate of [`${base}.ts`, path.join(base, 'index.ts'), base]) {
        if (!existsSync(candidate)) continue;
        if (statSync(candidate).isDirectory()) {
          for (const entry of readdirSync(candidate).filter((name) => name.endsWith('.ts'))) files.add(path.join(candidate, entry));
        } else {
          files.add(candidate);
        }
        break;
      }
    }
  }

  const vocabulary = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      vocabulary.add(match[0].replace(/_/g, '').toLowerCase());
    }
  }
  if (vocabulary.size === 0) throw new Error(`${target}: read no identifiers, so a surplus check over it would pass vacuously`);
  return vocabulary;
}

/** A public port symbol with no counterpart in the TypeScript the port is pinned to. */
export interface DartSurplusSymbol {
  file: string;
  symbol: string;
  mirrors: string;
}

/**
 * Public port symbols the pinned TypeScript does not name (Req 14.11).
 *
 * Matching is separator- and case-insensitive, so `TRADE_INSPECTION_HOURS` answers
 * for `tradeInspectionHours`: the two languages spell one constant differently and a
 * literal comparison would report every constant in the tree.
 */
export function dartPortSurplusSymbols(): DartSurplusSymbol[] {
  const surplus: DartSurplusSymbol[] = [];
  for (const port of dartAdvisoryPorts()) {
    const vocabulary = tsIdentifierVocabulary(port.mirrors);
    const symbols = dartTopLevelPublicSymbols(readFileSync(path.join(REPO_ROOT, port.file), 'utf8'));
    if (symbols.length === 0) throw new Error(`${port.file}: no public top-level declarations parsed`);
    for (const symbol of symbols) {
      if (!vocabulary.has(symbol.replace(/_/g, '').toLowerCase())) {
        surplus.push({ file: port.file, symbol, mirrors: port.mirrors });
      }
    }
  }
  return surplus;
}

/** Where a retired word was found, and on which surface (Req 14.4, P9). */
export interface RetiredVocabularyHit {
  term: string;
  surface: 'identifier' | 'string' | 'route' | 'asset' | 'golden';
  text: string;
  file: string;
  line: number;
}

/**
 * Split an identifier or a phrase into lower-case words.
 *
 * `DittoBond`, `ditto_bond` and `DITTO_BOND` all become `ditto bond`, which is what
 * Req 14.4's "without regard to case or to word separators" asks for. Matching then
 * looks for a whole word SEQUENCE, so `dealer` and `ideal` do not match `deal`.
 */
function vocabularyWords(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function mentionsTerm(text: string, term: string): boolean {
  return new RegExp(`\\b${vocabularyWords(term).replace(/\s+/g, '\\s+')}\\b`).test(vocabularyWords(text));
}

/** Dart string literals, with their line numbers. */
function dartStringLiterals(source: string): { text: string; line: number }[] {
  const literals: { text: string; line: number }[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      const start = index;
      index += 1;
      let text = '';
      while (index < source.length && source[index] !== char) {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index] === '\n') break;
        text += source[index];
        index += 1;
      }
      index += 1;
      literals.push({ text, line: lineOf(source, start) });
      continue;
    }
    index += 1;
  }
  return literals;
}

/**
 * A string literal that is a WIRE VALUE rather than member-facing copy.
 *
 * `'SHOPFRONT'` is the Postgres enum value and `ListingKind.shopfront` is the field
 * that carries it; neither is copy a member reads. The rule is structural — an
 * all-caps token, an import URI or a bare asset/route path — rather than a list of
 * files, because a list of files is an allowlist and would grow.
 */
function isWireLiteral(text: string): boolean {
  if (text.trim() === '') return true;
  if (/^[A-Z][A-Z0-9_]*$/.test(text)) return true;
  // A snake_case token is a column or JSON key. A bare lower-case WORD is not
  // exempted, because `Text('shopfront')` would be exactly the copy Req 14.4 forbids.
  if (/^[a-z][a-z0-9]*_[a-z0-9_]*$/.test(text)) return true;
  if (/^(?:package:|dart:|https?:)/.test(text)) return true;
  return false;
}

/**
 * Every retired word on every surface Req 14.4 names.
 *
 * WHY EACH SURFACE IS READ SEPARATELY. The existing scan in
 * `mobileDomainAgreement.test.ts` reads whole files, which is right for
 * `deals`/`dittobond`/`kyc_status` because those never appear legitimately. It cannot
 * be widened to the bare word `Deal`, because the Dart tree DOCUMENTS the retirement
 * — `hub_set_test.dart` asserts the sheet does not promise a "private deal" and
 * `shell_golden_cases.dart` explains why a golden is never named for one. Stripping
 * comments and separating code from copy is what lets the narrower word be enforced
 * at all, rather than being softened back to the plural.
 *
 * `memberFacingOnly` terms are checked against copy alone: `shopfront` is the
 * internal name for `listing_kind = 'SHOPFRONT'` and is legitimate in an identifier.
 */
export function dartRetiredVocabularySurfaces(
  terms: readonly string[],
  memberFacingOnly: readonly string[] = [],
): RetiredVocabularyHit[] {
  const hits: RetiredVocabularyHit[] = [];
  const record = (term: string, surface: RetiredVocabularyHit['surface'], text: string, file: string, line: number) => {
    hits.push({ term, surface, text, file: repoPath(file), line });
  };

  const dartFiles = walkDart(FLUTTER_LIB_DIR);
  if (dartFiles.length === 0) throw new Error('flutter_app/lib contains no Dart source files');

  for (const file of dartFiles) {
    const source = readFileSync(file, 'utf8');

    // Identifiers, and the route constants and asset paths that live among them.
    const code = stripDartCommentsAndStrings(source);
    for (const match of code.matchAll(/[A-Za-z_$][\w$]*/g)) {
      for (const term of terms) {
        if (mentionsTerm(match[0], term)) record(term, 'identifier', match[0], file, lineOf(code, match.index!));
      }
    }

    for (const literal of dartStringLiterals(source)) {
      const surface: RetiredVocabularyHit['surface'] = literal.text.startsWith('/') ? 'route' : 'string';
      const wire = isWireLiteral(literal.text);
      for (const term of terms) {
        if (!wire && mentionsTerm(literal.text, term)) record(term, surface, literal.text, file, literal.line);
      }
      for (const term of memberFacingOnly) {
        if (!wire && mentionsTerm(literal.text, term)) record(term, surface, literal.text, file, literal.line);
      }
    }
  }

  // Asset declarations, and the asset files themselves.
  const pubspec = path.join(REPO_ROOT, 'flutter_app', 'pubspec.yaml');
  if (!existsSync(pubspec)) throw new Error('flutter_app/pubspec.yaml is missing');
  const pubspecSource = readFileSync(pubspec, 'utf8');
  for (const match of pubspecSource.matchAll(/^\s*-\s*(assets\/[^\s#]*)/gm)) {
    for (const term of [...terms, ...memberFacingOnly]) {
      if (mentionsTerm(match[1], term)) record(term, 'asset', match[1], pubspec, lineOf(pubspecSource, match.index!));
    }
  }
  const assetsDir = path.join(REPO_ROOT, 'flutter_app', 'assets');
  if (existsSync(assetsDir)) {
    for (const asset of walkFiles(assetsDir)) {
      for (const term of [...terms, ...memberFacingOnly]) {
        if (mentionsTerm(path.basename(asset), term)) record(term, 'asset', repoPath(asset), asset, 1);
      }
    }
  }

  // Golden file names, and the case names the harness derives them from.
  const goldenDir = path.join(REPO_ROOT, 'flutter_app', 'test', 'golden');
  if (existsSync(goldenDir)) {
    for (const file of walkFiles(goldenDir)) {
      for (const term of [...terms, ...memberFacingOnly]) {
        if (mentionsTerm(path.basename(file), term)) record(term, 'golden', repoPath(file), file, 1);
      }
      if (!file.endsWith('.dart')) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bname\s*:\s*'([^']*)'/g)) {
        for (const term of [...terms, ...memberFacingOnly]) {
          if (mentionsTerm(match[1], term)) record(term, 'golden', match[1], file, lineOf(source, match.index!));
        }
      }
    }
  }

  return hits;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

/** Every `WebHandoff.<member>` call site the Flutter app makes (Req 14.6). */
export function dartWebHandoffCallSites(): SourceRef[] {
  const handoff = path.join(FLUTTER_LIB_DIR, 'core', 'web_handoff.dart');
  if (!existsSync(handoff)) throw new Error('flutter_app/lib/core/web_handoff.dart is missing');
  const sites: SourceRef[] = [];
  for (const file of walkDart(FLUTTER_LIB_DIR)) {
    if (file === handoff) continue;
    const source = readFileSync(file, 'utf8');
    const code = stripDartCommentsAndStrings(source);
    for (const match of code.matchAll(/\bWebHandoff\s*\.\s*\w+/g)) {
      sites.push({ file: repoPath(file), line: lineOf(source, match.index!) });
    }
  }
  return sites;
}
