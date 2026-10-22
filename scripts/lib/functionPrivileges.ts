// scripts/lib/functionPrivileges.ts
//
// Who may EXECUTE each `cardtrade` function once every migration has run, worked out
// from the migration TEXT. Pure: give it the files in apply order.
//
// WHY THIS EXISTS. Postgres grants EXECUTE on every new function to PUBLIC, and the
// `cardtrade` schema is exposed through PostgREST, so a SECURITY DEFINER function that a
// migration forgets to revoke is callable by anyone with the anon key, running as its
// owner and skipping RLS. Migration 0147 tried to turn that default off with
// `alter default privileges ... in schema cardtrade revoke execute ...`, but a
// schema-scoped default can only ADD privileges: it cannot remove the global PUBLIC
// grant, so it never did anything (probed on the live database, 2026-10-22). This
// model is the replacement guard. `tests/unit/functionPrivileges.test.ts` fails on any
// definer function members can call that is not on its allow-list.
//
// THE MODEL, following Postgres:
//   - a function is keyed by name and arity, because a different signature is a
//     different function with its own privileges;
//   - CREATE of a new key grants PUBLIC (unless a GLOBAL default revoke ran earlier);
//     CREATE OR REPLACE of an existing key keeps its privileges;
//   - DROP removes it, so a later CREATE starts from the default again;
//   - GRANT / REVOKE on a function add or remove grantees; `... ON ALL FUNCTIONS IN
//     SCHEMA cardtrade` applies to every function that exists at that point;
//   - `alter default privileges ... in schema ...` revokes are IGNORED (the 0147 lesson);
//     only a global one (no IN SCHEMA) changes the default for later CREATEs.
//   anon may execute when PUBLIC or anon holds the grant; authenticated when PUBLIC or
//   authenticated does.
//
// STRICT ON PURPOSE. A statement that names a `cardtrade` function in a GRANT, REVOKE,
// CREATE or DROP and cannot be parsed THROWS, rather than being skipped: a check that
// passes because it understood nothing is worse than no check.

/** One migration file, in apply order. */
export interface MigrationSource {
  name: string;
  sql: string;
}

/** What is known about one `cardtrade` function after every migration. */
export interface FunctionPrivileges {
  /** `name/arity`, e.g. `member_sale_stats/1`. */
  key: string;
  name: string;
  arity: number;
  securityDefiner: boolean;
  /** Trigger functions cannot be called as an RPC. */
  returnsTrigger: boolean;
  /** Roles holding EXECUTE: `public`, `anon`, `authenticated`, `service_role`, ... */
  grantees: Set<string>;
  /** The migration that last created it. */
  createdIn: string;
}

/** Can `role` (anon or authenticated) execute this function? */
export function canExecute(fn: FunctionPrivileges, role: 'anon' | 'authenticated'): boolean {
  return fn.grantees.has('public') || fn.grantees.has(role);
}

// --- Splitting SQL into statements ----------------------------------------

/**
 * Split SQL into statements on top-level semicolons. Comments are dropped, and the
 * contents of dollar-quoted bodies and string literals are replaced by placeholders, so
 * a `security definer` or a `;` inside a function body or a comment cannot be misread.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated block comment');
      i = end + 2;
      current += ' ';
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw new Error('unterminated string literal');
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") break;
        j += 1;
      }
      current += "'…'";
      i = j + 1;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        if (close === -1) throw new Error(`unterminated dollar quote ${tag[0]}`);
        current += ' $BODY$ ';
        i = close + tag[0].length;
        continue;
      }
    }
    if (ch === ';') {
      if (current.trim()) out.push(current.trim());
      current = '';
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.trim()) out.push(current.trim());
  return out.map((statement) => statement.replace(/\s+/g, ' '));
}

// --- Reading function references -------------------------------------------

/** The text between the parenthesis at `open` and its match. */
function balanced(text: string, open: number): { inner: string; end: number } {
  if (text[open] !== '(') throw new Error(`expected "(" at ${open} in: ${text.slice(0, 160)}`);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  throw new Error(`unbalanced parentheses in: ${text.slice(0, 160)}`);
}

/** How many arguments a parameter or type list has (top-level commas). */
function arityOf(list: string): number {
  if (!list.trim()) return 0;
  let depth = 0;
  let count = 1;
  for (const ch of list) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) count += 1;
  }
  return count;
}

/** `[schema.]name(args)` references, comma-separated, as in GRANT/REVOKE/DROP lists. */
function functionRefs(list: string, statement: string): Array<{ schema: string; name: string; arity: number | null }> {
  const refs: Array<{ schema: string; name: string; arity: number | null }> = [];
  let rest = list.trim();
  while (rest) {
    const head = /^(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?\s*/i.exec(rest);
    if (!head) throw new Error(`cannot read a function reference in: ${statement}`);
    let after = rest.slice(head[0].length);
    let arity: number | null = null;
    if (after.startsWith('(')) {
      const args = balanced(after, 0);
      arity = arityOf(args.inner);
      after = after.slice(args.end);
    }
    refs.push({ schema: (head[1] ?? 'public').toLowerCase(), name: head[2].toLowerCase(), arity });
    after = after.trim();
    if (!after) break;
    if (!after.startsWith(',')) throw new Error(`unexpected text after a function reference in: ${statement}`);
    rest = after.slice(1);
  }
  return refs;
}

/** Role names in a GRANT/REVOKE grantee list, lower-cased. */
function roleList(list: string): string[] {
  return list
    .replace(/\b(with grant option|cascade|restrict|granted by \S+)\b/gi, ' ')
    .split(',')
    .map((role) => role.trim().replace(/^"|"$/g, '').toLowerCase())
    .filter(Boolean);
}

// --- The model --------------------------------------------------------------

const SCHEMA = 'cardtrade';

/**
 * Replay the migrations and return every `cardtrade` function that exists at the end,
 * with who may execute it.
 */
export function functionPrivilegesAfter(migrations: readonly MigrationSource[]): Map<string, FunctionPrivileges> {
  const functions = new Map<string, FunctionPrivileges>();
  /** Whether a new function gets PUBLIC execute. Only a GLOBAL default revoke changes it. */
  let defaultPublic = true;

  for (const migration of migrations) {
    let statements: string[];
    try {
      statements = splitStatements(migration.sql);
    } catch (error) {
      throw new Error(`${migration.name}: ${(error as Error).message}`);
    }
    for (const statement of statements) {
      try {
        apply(statement, migration.name);
      } catch (error) {
        throw new Error(`${migration.name}: ${(error as Error).message}`);
      }
    }
  }
  return functions;

  function apply(statement: string, file: string): void {
    const lower = statement.toLowerCase();

    // CREATE [OR REPLACE] FUNCTION
    const create = /^create\s+(or\s+replace\s+)?function\s+/i.exec(statement);
    if (create) {
      const refText = statement.slice(create[0].length);
      const head = /^(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?\s*/i.exec(refText);
      if (!head) throw new Error(`cannot read a function name in: ${statement.slice(0, 160)}`);
      if ((head[1] ?? 'public').toLowerCase() !== SCHEMA) return;
      const args = balanced(refText, head[0].length);
      const name = head[2].toLowerCase();
      const arity = arityOf(args.inner);
      const key = `${name}/${arity}`;
      const rest = refText.slice(args.end).toLowerCase();
      const existing = functions.get(key);
      if (existing && !create[1]) throw new Error(`${key} created twice without OR REPLACE`);
      functions.set(key, {
        key,
        name,
        arity,
        securityDefiner: /\bsecurity\s+definer\b/.test(rest),
        returnsTrigger: /\breturns\s+(event_)?trigger\b/.test(rest),
        // OR REPLACE of an existing function keeps its privileges.
        grantees: existing ? existing.grantees : new Set(defaultPublic ? ['public'] : []),
        createdIn: file,
      });
      return;
    }

    // DROP FUNCTION
    const drop = /^drop\s+function\s+(if\s+exists\s+)?/i.exec(statement);
    if (drop) {
      const list = statement.slice(drop[0].length).replace(/\s+(cascade|restrict)\s*$/i, '');
      for (const ref of functionRefs(list, statement)) {
        if (ref.schema !== SCHEMA) continue;
        for (const key of [...functions.keys()]) {
          const fn = functions.get(key)!;
          if (fn.name === ref.name && (ref.arity === null || fn.arity === ref.arity)) functions.delete(key);
        }
      }
      return;
    }

    // ALTER DEFAULT PRIVILEGES: only a global revoke of function execute matters.
    if (/^alter\s+default\s+privileges\b/i.test(statement)) {
      if (/\bin\s+schema\b/i.test(statement)) return; // cannot remove the global PUBLIC grant
      if (/\brevoke\b.*\bon\s+functions\b.*\bfrom\b.*\bpublic\b/i.test(statement)) defaultPublic = false;
      if (/\bgrant\b.*\bon\s+functions\b.*\bto\b.*\bpublic\b/i.test(statement)) defaultPublic = true;
      return;
    }

    // GRANT / REVOKE on functions.
    const isGrant = /^grant\b/i.test(statement);
    const isRevoke = /^revoke\b/i.test(statement);
    if (!isGrant && !isRevoke) return;
    if (!/\bon\s+(all\s+functions|functions?|routines?)\b/i.test(statement)) return;
    // Only EXECUTE (or ALL) touches calling a function.
    const privileges = /^(?:grant|revoke)\s+(?:grant\s+option\s+for\s+)?(.*?)\s+on\s+/i.exec(statement)?.[1] ?? '';
    if (!/\b(all|execute)\b/i.test(privileges)) return;

    const split = isGrant ? /\s+to\s+/i : /\s+from\s+/i;
    const onIndex = lower.search(/\bon\s+(all\s+functions|functions?|routines?)\b/);
    const target = statement.slice(onIndex);
    const parts = target.split(split);
    if (parts.length < 2) throw new Error(`cannot read the grantees in: ${statement.slice(0, 200)}`);
    const roles = roleList(parts.slice(1).join(isGrant ? ' to ' : ' from '));
    const objects = parts[0];

    let affected: FunctionPrivileges[];
    const all = /^on\s+all\s+(functions|routines)\s+in\s+schema\s+(.+)$/i.exec(objects);
    if (all) {
      const schemas = all[2].split(',').map((schema) => schema.trim().replace(/"/g, '').toLowerCase());
      affected = schemas.includes(SCHEMA) ? [...functions.values()] : [];
    } else {
      const list = objects.replace(/^on\s+(functions?|routines?)\s+/i, '');
      affected = [];
      for (const ref of functionRefs(list, statement)) {
        if (ref.schema !== SCHEMA) continue;
        const matches = [...functions.values()].filter(
          (fn) => fn.name === ref.name && (ref.arity === null || fn.arity === ref.arity),
        );
        if (matches.length === 0) {
          throw new Error(`${isGrant ? 'grant on' : 'revoke from'} unknown function ${ref.name}/${ref.arity ?? '?'}`);
        }
        affected.push(...matches);
      }
    }
    for (const fn of affected) {
      for (const role of roles) {
        if (isGrant) fn.grantees.add(role);
        else fn.grantees.delete(role);
      }
    }
  }
}
