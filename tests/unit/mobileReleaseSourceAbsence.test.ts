// tests/unit/mobileReleaseSourceAbsence.test.ts
//
// Three things that must be provably ABSENT before the Flutter release ships
// (`.kiro/specs/mobile-release-readiness/` task 13.2). Each is absent for a
// different reason, so each gets its own parser rather than one grep:
//
//   1. No hard-coded contract step list in the two contract rooms (Req 12.1).
//      SATISFIED by `.kiro/specs/mobile-parity/` task 12, which serves the derived
//      plan from `app/api/mobile/{cash-sale,trades}/step-plan` and deleted the
//      labels, the state→column maps and the halted sets.
//   2. `env.dart` / `ConfigKeys` declare no secret-shaped key name (Req 6.4).
//   3. No migration makes the `message-attachments` bucket public (Req 12.7).
//
// DISCIPLINE (`.kiro/steering/flutter.md`). Every parser here THROWS on source it
// cannot understand rather than returning an empty set. A check that passes
// vacuously is worse than no check: it reports a property it never evaluated. That
// is not hypothetical in this repo — the first mobile union parser read a semicolon
// inside a `//` comment as the end of a declaration and reported the resulting
// missing members as drift.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = process.cwd();
const FLUTTER_LIB = path.join(REPO, 'flutter_app', 'lib');
const MIGRATIONS = path.join(REPO, 'supabase', 'migrations');

// ─── Shared Dart helpers ──────────────────────────────────────────────────────

/**
 * Remove Dart comments while leaving string literals intact.
 *
 * String-aware on purpose. `env.dart` carries `'https://noditto.app'` as a
 * `defaultValue`, and a naive `//`-to-end-of-line strip would swallow the rest of
 * that declaration — which is exactly the class of parser bug the steering doc
 * records. Comments must go because BOTH files under check discuss service-role and
 * secret keys in prose in order to forbid them; scanning raw text would flag the
 * prohibition as the violation.
 */
function stripDartComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "'" || c === '"') {
      const quote = c;
      out += c;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        if (source[i] === '\n') {
          // An unterminated literal means we have lost the plot; do not guess.
          throw new Error('stripDartComments: unterminated string literal');
        }
        i += 1;
      }
      continue;
    }

    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new Error('stripDartComments: unterminated block comment');
      i = end + 2;
      continue;
    }

    out += c;
    i += 1;
  }
  return out;
}

function readDart(relative: string): string {
  const full = path.join(FLUTTER_LIB, relative);
  const raw = readFileSync(full, 'utf8');
  if (!/^\s*(\/\/|import |library )/m.test(raw)) {
    throw new Error(`readDart: ${relative} does not look like a Dart source file`);
  }
  return raw;
}

// ─── 1. Hard-coded contract step lists (Req 12.1) ─────────────────────────────

/**
 * The files that render a contract progress rail on mobile.
 *
 * The task names `trade_progress_rail.dart` and `sale_room_screen.dart`. The sale
 * screen does NOT hold a list — it calls `saleContractSteps`, and the list lives in
 * `sales/widgets/sale_progress_rail.dart`. Both are listed here rather than
 * "correcting" the task, because Req 12.1's subject is the Release_Build, not two
 * paths: a list that moved one file sideways is still a hard-coded step plan in the
 * bundle.
 */
const STEP_RAIL_SOURCES = [
  'features/trades/widgets/trade_progress_rail.dart',
  'features/sales/screens/sale_room_screen.dart',
  'features/sales/widgets/sale_progress_rail.dart',
] as const;

/**
 * Findings that constitute a locally-declared contract step plan.
 *
 * Two shapes count, and both are the plan rather than a rendering of it:
 *   - a `const List<String>` literal of column labels, and
 *   - a `const Map<TradeState|CashSaleStatus, int>` mapping a server-reported state
 *     onto a column index.
 *
 * The second matters as much as the first. Deleting the labels while keeping the map
 * would leave the phone still deciding how far a contract has progressed, which is
 * the decision Req 12.1 moves to the server.
 */
function findHardCodedStepPlan(relative: string): string[] {
  const source = stripDartComments(readDart(relative));
  const findings: string[] = [];

  for (const match of source.matchAll(
    /(?:const|final)\s+List<String>\s+(\w+)\s*=\s*(?:const\s*)?<String>\[/g,
  )) {
    findings.push(`${relative}: const List<String> ${match[1]}`);
  }

  for (const match of source.matchAll(
    /(?:const|final)\s+Map<\s*(TradeState|CashSaleStatus)\s*,\s*int\s*>\s+(\w+)\s*=/g,
  )) {
    findings.push(`${relative}: state→column map ${match[2]} (Map<${match[1]}, int>)`);
  }

  return findings;
}

// ─── 2. Secret-shaped config key names (Req 6.4) ───────────────────────────────

/**
 * Substrings that make a key name read as a credential the bundle must not carry.
 *
 * Compared against a NORMALISED name — lower-cased with `_`, `-` and spaces removed
 * — so `SERVICE_ROLE_KEY`, `service-role` and `serviceRole` are one rule rather than
 * three. Hence the entries are written already-normalised.
 */
const FORBIDDEN_KEY_FRAGMENTS = [
  'servicerole',
  'secret',
  'privatekey',
  'sklive',
  'sktest',
  'whsec',
] as const;

function normaliseKeyName(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, '');
}

interface ConfigDeclaration {
  file: string;
  /** The Dart identifier, e.g. `stripePublishableKey`. */
  identifier: string;
  /** Every string literal in the initialiser, e.g. the `--dart-define` key name. */
  literals: string[];
}

/**
 * Every `static const` declaration in a Dart class body.
 *
 * SCANS DECLARATIONS, NOT THE WHOLE FILE, and that is the load-bearing choice here.
 * `env.dart` says "Nothing here may be a service-role key or a Stripe secret key"
 * and `config_gate.dart` says "No service-role key and no Stripe secret key is a
 * Required_Config_Key". Both sentences exist to forbid the thing this check looks
 * for. A whole-file scan would fail on the prohibition and could only be made green
 * by deleting the comment that records why the rule exists.
 */
function parseStaticConstDeclarations(relative: string): ConfigDeclaration[] {
  const source = stripDartComments(readDart(relative));
  const declarations: ConfigDeclaration[] = [];

  const pattern = /static\s+const\s+(?:[\w<>,\s?]*?\s+)?(\w+)\s*=\s*([^;]*);/g;
  for (const match of source.matchAll(pattern)) {
    const [, identifier, initialiser] = match;
    const literals = [...initialiser.matchAll(/'([^']*)'|"([^"]*)"/g)].map(
      (m) => m[1] ?? m[2],
    );
    declarations.push({ file: relative, identifier, literals });
  }

  if (declarations.length < 3) {
    throw new Error(
      `parseStaticConstDeclarations: found ${declarations.length} declarations in ` +
        `${relative}; the file has been restructured and this check is no longer ` +
        'reading it. Fix the parser rather than accepting the empty result.',
    );
  }

  return declarations;
}

function secretShapedNames(declarations: ConfigDeclaration[]): string[] {
  const offenders: string[] = [];
  for (const declaration of declarations) {
    for (const candidate of [declaration.identifier, ...declaration.literals]) {
      const normalised = normaliseKeyName(candidate);
      const hit = FORBIDDEN_KEY_FRAGMENTS.find((fragment) =>
        normalised.includes(fragment),
      );
      if (hit) {
        offenders.push(`${declaration.file}: ${declaration.identifier} → "${candidate}" matches "${hit}"`);
      }
    }
  }
  return offenders;
}

// ─── 3. The message-attachments bucket stays private (Req 12.7) ────────────────

const ATTACHMENT_BUCKET = 'message-attachments';

interface MigrationFile {
  name: string;
  /** Comment-free SQL. `--` prose describing a public bucket is not a public bucket. */
  sql: string;
}

function readMigrations(): MigrationFile[] {
  const names = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql'));
  if (names.length === 0) {
    throw new Error(`readMigrations: no .sql files under ${MIGRATIONS}`);
  }
  return names.sort().map((name) => ({
    name,
    sql: stripSqlComments(readFileSync(path.join(MIGRATIONS, name), 'utf8')),
  }));
}

function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      out += c;
      i += 1;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new Error('stripSqlComments: unterminated block comment');
      i = end + 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * The text of every statement starting at `keyword`, up to its terminating `;`.
 *
 * Throws on an unterminated statement instead of reading to end of file: a
 * `storage.buckets` write this check could not delimit is a write it could not
 * inspect.
 */
function statementsStartingWith(file: MigrationFile, keyword: RegExp): string[] {
  const anchor = new RegExp(keyword.source, 'gi');
  const out: string[] = [];
  for (const match of file.sql.matchAll(anchor)) {
    const start = match.index ?? 0;
    const end = file.sql.indexOf(';', start);
    if (end === -1) {
      throw new Error(
        `statementsStartingWith: unterminated "${match[0]}" statement in ${file.name}`,
      );
    }
    out.push(file.sql.slice(start, end));
  }
  return out;
}

/** Split a comma list at depth zero, respecting quotes, parens and `array[...]`. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const ch of text) {
    if (quoted) {
      current += ch;
      if (ch === "'") quoted = false;
      continue;
    }
    if (ch === "'") {
      quoted = true;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

interface BucketFinding {
  /** Where it was found, for the failure message. */
  where: string;
  /** What makes it a violation. */
  what: string;
}

/**
 * Every way a migration could turn the attachment bucket public.
 *
 * Returns findings; the caller asserts the list is empty. Also returns how many
 * definitions of the bucket it managed to READ, so the caller can refuse to pass on
 * a run that found none.
 */
function auditAttachmentBucket(
  files: MigrationFile[] = readMigrations(),
): { findings: BucketFinding[]; definitions: number } {
  const findings: BucketFinding[] = [];
  let definitions = 0;

  for (const file of files) {
    // (a) INSERT — the shape 0100 uses to create it.
    for (const statement of statementsStartingWith(file, /insert\s+into\s+storage\.buckets/)) {
      if (!statement.includes(`'${ATTACHMENT_BUCKET}'`)) continue;
      definitions += 1;

      const columnMatch = /storage\.buckets\s*\(([^)]*)\)/i.exec(statement);
      const valuesMatch = /values\s*\(([\s\S]*)\)\s*(?:on\s+conflict[\s\S]*)?$/i.exec(
        statement,
      );
      if (!columnMatch || !valuesMatch) {
        throw new Error(
          `auditAttachmentBucket: cannot read the column list or values of the ` +
            `${ATTACHMENT_BUCKET} insert in ${file.name}`,
        );
      }

      const columns = splitTopLevel(columnMatch[1]).map((c) => c.toLowerCase());
      const values = splitTopLevel(valuesMatch[1]);
      if (columns.length !== values.length) {
        throw new Error(
          `auditAttachmentBucket: ${file.name} lists ${columns.length} columns and ` +
            `${values.length} values for ${ATTACHMENT_BUCKET}; refusing to guess ` +
            'which value is `public`.',
        );
      }

      const publicIndex = columns.indexOf('public');
      if (publicIndex !== -1 && /^true$/i.test(values[publicIndex].trim())) {
        findings.push({
          where: file.name,
          what: `insert into storage.buckets sets public = true`,
        });
      }

      // `on conflict ... do update set public = <expr>` is the same decision made
      // on a re-run, and 0100 uses it.
      const conflict = /on\s+conflict[\s\S]*?set([\s\S]*)$/i.exec(statement);
      if (conflict) {
        const publicAssignment = /\bpublic\s*=\s*([\w.]+)/i.exec(conflict[1]);
        if (publicAssignment && /^true$/i.test(publicAssignment[1].trim())) {
          findings.push({
            where: file.name,
            what: 'on conflict do update sets public = true',
          });
        }
      }
    }

    // (b) UPDATE — flipping an existing bucket. A statement with no predicate at all
    // is counted as hitting every bucket, this one included.
    for (const statement of statementsStartingWith(file, /update\s+storage\.buckets/)) {
      const setsPublicTrue = /\bpublic\s*=\s*true\b/i.test(statement);
      if (!setsPublicTrue) continue;
      const namesAnotherBucket =
        /'[\w-]+'/.test(statement) && !statement.includes(`'${ATTACHMENT_BUCKET}'`);
      if (namesAnotherBucket) continue;
      findings.push({
        where: file.name,
        what: 'update storage.buckets sets public = true',
      });
    }

    // (c) A read policy for an unauthenticated role. `public = false` on the bucket
    // is not protection on its own if a policy hands `anon` select on its objects.
    for (const statement of statementsStartingWith(file, /create\s+policy/)) {
      if (!/storage\.objects/i.test(statement)) continue;
      if (!statement.includes(ATTACHMENT_BUCKET)) continue;
      if (!/\bto\s+(anon|public)\b/i.test(statement)) continue;
      if (!/for\s+(select|all)\b/i.test(statement)) continue;
      findings.push({
        where: file.name,
        what: 'storage.objects policy grants anon/public read on the bucket',
      });
    }
  }

  if (definitions === 0) {
    throw new Error(
      `auditAttachmentBucket: found no migration defining the ${ATTACHMENT_BUCKET} ` +
        'bucket. 0100 creates it; if that has moved, this check is reading nothing ' +
        'and must be fixed rather than trusted.',
    );
  }

  return { findings, definitions };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Flutter release source-absence checks (task 13.2)', () => {
  // SATISFIED as of `.kiro/specs/mobile-parity/` task 12. This assertion spent a
  // while as an `it.fails` with a companion pending-state proof, because both lists
  // were still in the tree and `it.skip` would have stayed quiet on the day they
  // went. Task 12 served the derived plan from
  // `app/api/mobile/{cash-sale,trades}/step-plan` and deleted the labels, the
  // state→column maps and the halted sets, so this is now a plain assertion and the
  // proof test has been removed along with the thing it was proving.
  //
  // The three files below are still parsed rather than dropped from the list: they
  // still exist and still render the rails, and reading them is what makes "no
  // hard-coded step plan" a checked fact rather than an absence of files.
  it('declares no hard-coded contract step plan in a contract room', () => {
    const findings = STEP_RAIL_SOURCES.flatMap(findHardCodedStepPlan);

    expect(
      findings,
      'Req 12.1: the Release_Build must contain no hard-coded contract step ' +
        'list. If a phone keeps its own labels and its own state→column map, the ' +
        'rail tells a member how far their contract has progressed from a plan ' +
        'the server never agreed to — so a new Trade_State or Cash_Sale_Status ' +
        'ships as a silently mis-drawn room. The plan is served; render that.',
    ).toEqual([]);
  });

  // The counterpart to the check above, kept for the reason the retired pending-state
  // proof existed: an absence check that parsed nothing would pass vacuously. This
  // asserts the parser still READS the rails, which is a different claim from finding
  // nothing in them.
  it('reads the rail sources it claims to check', () => {
    for (const relative of STEP_RAIL_SOURCES) {
      const source = stripDartComments(readDart(relative));
      expect(
        source.includes('ContractStep'),
        `${relative} no longer mentions ContractStep, so this check is reading a ` +
          'file that has moved or been rewritten. Fix the file list rather than ' +
          'accepting the empty result.',
      ).toBe(true);
    }
  });

  it('declares no secret-shaped config key name (Req 6.4)', () => {
    const declarations = [
      ...parseStaticConstDeclarations('core/env.dart'),
      ...parseStaticConstDeclarations('core/config_gate.dart'),
    ];

    expect(
      secretShapedNames(declarations),
      'Req 6.4: an app bundle ships to devices, so every value it can read is ' +
        'disclosed. A service-role key would bypass RLS for anyone who unzipped ' +
        'the APK, and a Stripe secret key would let them move money. This check ' +
        'scans declarations only — both files discuss these key types in prose in ' +
        'order to forbid them.',
    ).toEqual([]);
  });

  it('reads the config declarations it claims to check', () => {
    // Guards the check above against passing because it parsed nothing.
    const env = parseStaticConstDeclarations('core/env.dart');
    const gate = parseStaticConstDeclarations('core/config_gate.dart');

    expect(env.map((d) => d.identifier)).toContain('supabaseAnonKey');
    expect(gate.map((d) => d.identifier)).toContain('stripePublishableKey');
  });

  it('flags a secret-shaped name however it is spelled', () => {
    const offenders = secretShapedNames([
      { file: 'synthetic', identifier: 'serviceRoleKey', literals: [] },
      { file: 'synthetic', identifier: 'adminKey', literals: ['SUPABASE_SERVICE_ROLE_KEY'] },
      { file: 'synthetic', identifier: 'x', literals: ['STRIPE-SECRET-KEY'] },
      { file: 'synthetic', identifier: 'y', literals: ['WEBHOOK_PRIVATE_KEY'] },
      // Legitimate, and must stay legitimate: "key" alone is not a secret.
      { file: 'synthetic', identifier: 'supabaseAnonKey', literals: ['SUPABASE_ANON_KEY'] },
      { file: 'synthetic', identifier: 'stripePublishableKey', literals: ['STRIPE_PUBLISHABLE_KEY'] },
    ]);
    expect(offenders).toHaveLength(4);
  });

  it('has no migration that makes the message-attachments bucket public (Req 12.7)', () => {
    const { findings, definitions } = auditAttachmentBucket();

    expect(
      findings,
      'Req 12.7: the message-attachments bucket holds what members photograph for ' +
        'a dispute — receipts, packaging, damaged cards, and whatever else is in ' +
        'frame. Making it public is a data-exposure change, not a convenience: ' +
        'object paths are guessable enough that "private by obscurity" is not ' +
        'private, and nothing in the app needs it. 0100 creates the bucket with ' +
        'public = false, reads go through signed download URLs, and mobile shows a ' +
        'view-on-web placeholder (task 14.2) precisely so that stays true.',
    ).toEqual([]);

    // The audit must have found the bucket to have checked anything.
    expect(definitions).toBeGreaterThan(0);
  });

  // The check above passes today, so on its own it proves only that it found no
  // violation — not that it CAN. These feed it the shapes a future migration would
  // use, so "green" means "looked and found nothing".
  describe('the bucket audit detects the shapes it is meant to catch', () => {
    const synthetic = (sql: string): MigrationFile[] => [
      { name: '9999_synthetic.sql', sql: stripSqlComments(sql) },
    ];

    it('catches an insert that creates the bucket public', () => {
      const { findings } = auditAttachmentBucket(
        synthetic(`
          insert into storage.buckets (id, name, public, allowed_mime_types)
          values ('message-attachments', 'message-attachments', true,
                  array['image/png', 'image/jpeg']);
        `),
      );
      expect(findings).toHaveLength(1);
    });

    it('catches an on-conflict clause that flips it public on a re-run', () => {
      const { findings } = auditAttachmentBucket(
        synthetic(`
          insert into storage.buckets (id, name, public)
          values ('message-attachments', 'message-attachments', false)
          on conflict (id) do update set public = true;
        `),
      );
      expect(findings).toHaveLength(1);
    });

    it('catches an update that flips an existing bucket public', () => {
      const { findings } = auditAttachmentBucket(
        synthetic(`
          insert into storage.buckets (id, name, public)
          values ('message-attachments', 'message-attachments', false);
          update storage.buckets set public = true where id = 'message-attachments';
        `),
      );
      expect(findings).toHaveLength(1);
    });

    it('catches a blanket update with no predicate', () => {
      const { findings } = auditAttachmentBucket(
        synthetic(`
          insert into storage.buckets (id, name, public)
          values ('message-attachments', 'message-attachments', false);
          update storage.buckets set public = true;
        `),
      );
      expect(findings).toHaveLength(1);
    });

    it('catches an anon read policy on the bucket objects', () => {
      const { findings } = auditAttachmentBucket(
        synthetic(`
          insert into storage.buckets (id, name, public)
          values ('message-attachments', 'message-attachments', false);
          create policy message_attachments_read on storage.objects
            for select to anon
            using (bucket_id = 'message-attachments');
        `),
      );
      expect(findings).toHaveLength(1);
    });

    it('ignores another bucket being made public', () => {
      const { findings } = auditAttachmentBucket(
        synthetic(`
          insert into storage.buckets (id, name, public)
          values ('message-attachments', 'message-attachments', false);
          update storage.buckets set public = true where id = 'item-images';
        `),
      );
      expect(findings).toEqual([]);
    });

    it('throws rather than passing when it cannot find the bucket at all', () => {
      expect(() =>
        auditAttachmentBucket(synthetic('alter table cardtrade.messages add column x int;')),
      ).toThrow(/found no migration defining/);
    });

    it('throws rather than guessing when columns and values do not line up', () => {
      expect(() =>
        auditAttachmentBucket(
          synthetic(`
            insert into storage.buckets (id, name, public)
            values ('message-attachments', 'message-attachments');
          `),
        ),
      ).toThrow(/refusing to guess/);
    });
  });
});
