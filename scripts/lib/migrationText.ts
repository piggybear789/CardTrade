// scripts/lib/migrationText.ts
//
// Strict readers for migration TEXT, for the guard tests that pin SQL to TypeScript
// (tradeClockAgreement, migrationHoldReestimate, migrationRestoreUnclaimed,
// migrationHandoverLock, eventCopyCoverage, migrationTrackingClock).
//
// Same rules as `mobileContract.ts` ("Adding a check" in flutter.md): every reader
// THROWS when it cannot find what it was asked for, rather than returning an empty
// result a test could pass against. A check that passes vacuously is worse than none.
//
// `--` line comments are stripped before anything is matched, so prose describing a
// function body cannot be read as the body. String literals are left intact, which is
// why the comment stripper only removes `--` that is not inside a single-quoted string.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { MIGRATIONS_DIR, migrationFiles } from './mobileContract';

/** One `create or replace function cardtrade.<name>(...)` definition. */
export interface SqlFunctionDefinition {
  name: string;
  /** Migration file it came from. */
  file: string;
  /** The raw argument list between the parentheses. */
  args: string;
  /** Number of top-level arguments. */
  argCount: number;
  /** The dollar-quoted body, without its delimiters. */
  body: string;
  /** Everything from `create` to the closing delimiter. */
  text: string;
}

/** Remove `--` comments that are not inside a single-quoted literal. */
export function stripSqlLineComments(sql: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inString) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          out += "'";
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

/** A migration's text with line comments removed. */
export function migrationSql(file: string): string {
  return stripSqlLineComments(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
}

function topLevelArgCount(args: string): number {
  if (!args.trim()) return 0;
  let depth = 0;
  let count = 1;
  for (const ch of args) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) count += 1;
  }
  return count;
}

/** Every definition of a `cardtrade` function in one migration's text. */
export function functionDefinitionsIn(file: string, sql = migrationSql(file)): SqlFunctionDefinition[] {
  const defs: SqlFunctionDefinition[] = [];
  const head = /create\s+or\s+replace\s+function\s+cardtrade\.(\w+)\s*\(/gi;
  for (const match of sql.matchAll(head)) {
    const name = match[1];
    const openParen = match.index! + match[0].length - 1;
    let depth = 0;
    let closeParen = -1;
    for (let i = openParen; i < sql.length; i += 1) {
      if (sql[i] === '(') depth += 1;
      else if (sql[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          closeParen = i;
          break;
        }
      }
    }
    if (closeParen === -1) throw new Error(`${file}: unbalanced argument list for ${name}`);
    const args = sql.slice(openParen + 1, closeParen);

    const rest = sql.slice(closeParen);
    const asMatch = rest.match(/\bas\s+(\$[A-Za-z_]*\$)/i);
    if (!asMatch || asMatch.index === undefined) {
      throw new Error(`${file}: cannot find the dollar-quoted body of ${name}`);
    }
    const tag = asMatch[1];
    const bodyStart = closeParen + asMatch.index + asMatch[0].length;
    const bodyEnd = sql.indexOf(tag, bodyStart);
    if (bodyEnd === -1) throw new Error(`${file}: unterminated body ${tag} for ${name}`);

    defs.push({
      name,
      file,
      args,
      argCount: topLevelArgCount(args),
      body: sql.slice(bodyStart, bodyEnd),
      text: sql.slice(match.index!, bodyEnd + tag.length),
    });
  }
  return defs;
}

/**
 * The newest definition of `cardtrade.<name>` across every migration in applied
 * order, optionally for one overload (`argCount`). Throws when there is none.
 */
export function newestFunctionDefinition(
  name: string,
  opts: { argCount?: number } = {},
): SqlFunctionDefinition {
  let newest: SqlFunctionDefinition | undefined;
  for (const file of migrationFiles()) {
    for (const def of functionDefinitionsIn(file)) {
      if (def.name !== name) continue;
      if (opts.argCount !== undefined && def.argCount !== opts.argCount) continue;
      newest = def;
    }
  }
  if (!newest) {
    const which = opts.argCount === undefined ? '' : ` with ${opts.argCount} arguments`;
    throw new Error(`No migration defines cardtrade.${name}${which}`);
  }
  return newest;
}

/** The value a pinned `select N` clock function returns. Throws on any other shape. */
export function pinnedIntegerFunction(name: string): { value: number; file: string } {
  const def = newestFunctionDefinition(name, { argCount: 0 });
  const match = def.body.match(/^\s*select\s+(\d+)\s*;?\s*$/i);
  if (!match) {
    throw new Error(
      `cardtrade.${name} (${def.file}) is not the pinned "select N" form; cannot compare it`,
    );
  }
  return { value: Number(match[1]), file: def.file };
}

/**
 * Every complete top-level statement in a migration that starts with `prefix`
 * (case- and whitespace-insensitive), up to its terminating semicolon. Statements
 * inside function bodies are not top level and are not returned.
 */
export function topLevelStatements(file: string, prefix: RegExp): string[] {
  const sql = migrationSql(file);
  // Blank out dollar-quoted bodies so their inner statements are not matched.
  const masked = sql.replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, (m) => ' '.repeat(m.length));
  const out: string[] = [];
  const start = new RegExp(prefix.source, prefix.flags.includes('g') ? prefix.flags : `${prefix.flags}g`);
  for (const match of masked.matchAll(start)) {
    const end = masked.indexOf(';', match.index!);
    if (end === -1) throw new Error(`${file}: unterminated statement at ${match.index}`);
    out.push(sql.slice(match.index!, end + 1));
  }
  return out;
}

/** Collapse whitespace and lower-case, for comparing SQL fragments. */
export function normaliseSql(fragment: string): string {
  return fragment.replace(/\s+/g, ' ').trim().toLowerCase();
}
