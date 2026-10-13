// scripts/lib/migrationGrants.ts
//
// The effective member (`authenticated`) privileges on a `cardtrade` table, computed by
// folding every GRANT / REVOKE in the migrations in applied order (ESC-13/22/26).
//
// Same rule as the other parsers here (flutter.md, "Adding a check"): STRICT. A
// GRANT/REVOKE statement naming a table it was asked about, in a shape it cannot read,
// THROWS rather than being skipped, because a check that passes vacuously is worse than
// none.
//
// Semantics followed (PostgreSQL):
//   * `all` / `all privileges` is every table privilege;
//   * revoking a TABLE-level privilege also revokes that privilege on every column;
//   * revoking a COLUMN privilege does not touch a table-level grant.
//
// Assumption, recorded: `alter default privileges` statements are not folded. 0072
// removed the default member grants; every table this guards either predates them and
// was fixed explicitly there, or was created after.

import { MIGRATIONS_DIR, migrationFiles } from './mobileContract';
import { migrationSql } from './migrationText';

const ALL_PRIVILEGES = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] as const;
export type TablePrivilege = (typeof ALL_PRIVILEGES)[number];

export interface EffectivePrivileges {
  /** Table-level privileges. */
  table: Set<TablePrivilege>;
  /** Column-level privileges, by privilege. */
  columns: Map<TablePrivilege, Set<string>>;
}

function emptyPrivileges(): EffectivePrivileges {
  return { table: new Set(), columns: new Map() };
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

interface ParsedPrivilege {
  privilege: TablePrivilege;
  columns: string[] | null;
}

function parsePrivileges(text: string, where: string): ParsedPrivilege[] {
  const out: ParsedPrivilege[] = [];
  for (const part of splitTopLevel(text)) {
    const match = part.match(/^(\w+)(?:\s+privileges)?\s*(?:\(([^)]*)\))?$/i);
    if (!match) throw new Error(`${where}: cannot read privilege "${part}"`);
    const name = match[1].toLowerCase();
    const columns = match[2] ? match[2].split(',').map((c) => c.trim().toLowerCase()).filter(Boolean) : null;
    if (name === 'all') {
      if (columns) throw new Error(`${where}: column-level ALL is not supported by this parser`);
      for (const privilege of ALL_PRIVILEGES) out.push({ privilege, columns: null });
      continue;
    }
    if (!(ALL_PRIVILEGES as readonly string[]).includes(name)) {
      throw new Error(`${where}: unknown table privilege "${name}"`);
    }
    out.push({ privilege: name as TablePrivilege, columns });
  }
  return out;
}

/** Top-level GRANT/REVOKE statements of one migration, whitespace-normalised. */
function grantStatements(file: string): string[] {
  const sql = migrationSql(file);
  const masked = sql.replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, (m) => ' '.repeat(m.length));
  const out: string[] = [];
  for (const match of masked.matchAll(/\b(grant|revoke)\b/gi)) {
    // Statement start only: the previous non-space character is ';' or start of file.
    const before = masked.slice(0, match.index).trimEnd();
    if (before.length > 0 && !before.endsWith(';')) continue;
    const end = masked.indexOf(';', match.index!);
    if (end === -1) throw new Error(`${file}: unterminated statement at ${match.index}`);
    out.push(sql.slice(match.index!, end + 1).replace(/\s+/g, ' ').trim());
  }
  return out;
}

/**
 * Effective privileges `authenticated` holds on `cardtrade.<table>` after every
 * migration.
 */
export function effectiveMemberPrivileges(table: string): EffectivePrivileges {
  const state = emptyPrivileges();
  const tableRef = new RegExp(`\\bon\\s+(?:table\\s+)?cardtrade\\.${table}\\b`, 'i');
  for (const file of migrationFiles()) {
    for (const statement of grantStatements(file)) {
      if (!tableRef.test(statement)) continue;
      const where = `${file}: ${statement}`;
      // Function / sequence / schema grants never name `on cardtrade.<table>` this way.
      const match = statement.match(
        /^(grant|revoke)\s+(.+?)\s+on\s+(?:table\s+)?cardtrade\.(\w+)\s+(to|from)\s+(.+?)(?:\s+with\s+grant\s+option)?(?:\s+cascade|\s+restrict)?;$/i,
      );
      if (!match) throw new Error(`cannot parse ${where}`);
      if (match[3].toLowerCase() !== table.toLowerCase()) continue;
      const verb = match[1].toLowerCase();
      if ((verb === 'grant') !== (match[4].toLowerCase() === 'to')) throw new Error(`malformed ${where}`);
      const grantees = match[5].split(',').map((g) => g.trim().toLowerCase());
      if (!grantees.includes('authenticated')) continue;

      for (const { privilege, columns } of parsePrivileges(match[2], where)) {
        if (verb === 'grant') {
          if (columns) {
            const set = state.columns.get(privilege) ?? new Set<string>();
            for (const column of columns) set.add(column);
            state.columns.set(privilege, set);
          } else {
            state.table.add(privilege);
          }
        } else if (columns) {
          const set = state.columns.get(privilege);
          if (set) for (const column of columns) set.delete(column);
        } else {
          state.table.delete(privilege);
          state.columns.delete(privilege);
        }
      }
    }
  }
  return state;
}

/** True when members can perform `privilege` on the table at all. */
export function memberCan(table: string, privilege: TablePrivilege): boolean {
  const state = effectiveMemberPrivileges(table);
  return state.table.has(privilege) || (state.columns.get(privilege)?.size ?? 0) > 0;
}

export { MIGRATIONS_DIR };
