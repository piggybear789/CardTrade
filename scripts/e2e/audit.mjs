// scripts/e2e/audit.mjs
//
// THE AUDIT SUITE'S ENTRY POINT (.kiro/specs/e2e-ux-audit-suite, design "npm scripts",
// "Safety preflight"). `npm run audit` runs, in order:
//
//   1. the static preflight: the harness schema must be `cardtrade_dev` and no Stripe
//      key variable may hold a live key (Req 1.1, 1.2, 1.3). Nothing has been built or
//      started yet, so a refusal here costs nothing;
//   2. `build-for-e2e.mjs`, the production build in `.next-e2e` with the suite's client
//      env baked in (Req 4.1). Skipped with `--no-build`;
//   3. the client env stamp check: the build's fingerprint must match the run's
//      `NEXT_PUBLIC_*` values, else STALE_BUILD (Req 4.2, F18);
//   4. `playwright test --list --reporter=json` into `audit-artifacts/.pathways.json`,
//      the Pathway universe the `preflight` project checks the Coverage_Map against
//      (tests/e2e/audit/pathwayUniverse.ts). Always the WHOLE suite, never the subset,
//      because the Coverage_Map is checked against every Pathway the specs define;
//   5. `playwright test` with the subset translated into grep and project arguments;
//   6. the report (`scripts/e2e/audit-report.ts`, task 17.1), when it exists. It runs
//      after a failed run too, because a failed run is the one worth reading. The exit
//      code is Playwright's.
//
// One run id (`E2E_RUN_ID`, tests/e2e/support/marker.ts) is fixed here, before any
// child starts, so the list step, Playwright, its workers, both app servers and the
// report all name the same run.
//
//   npm run audit                                    whole suite
//   npm run audit -- --area cash-sale                one area (repeatable)
//   npm run audit -- --pathway cash-sale.pay         one Pathway (repeatable)
//   npm run audit -- --viewport phone                one viewport
//   npm run audit -- --no-build                      reuse the last build (still stamp-checked)
//   npm run audit -- --dry-run --area offers         print the plan, run nothing
//   npm run audit -- --area offers -- --headed       everything after a second `--` goes to Playwright
//
// npm consumes the FIRST `--`, so Playwright passthrough needs a second one.
//
// `--area` and `--pathway` together select the UNION: every Pathway in a named area
// plus every named Pathway.
//
// There is deliberately no flag that skips the preflight or the live-key check (Req 1.6).
//
// Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 35.1, 35.3

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

/** The Playwright CLI, run through `node` so nothing depends on `npx` or PATH. */
export const PLAYWRIGHT_CLI = path.join('node_modules', '@playwright', 'test', 'cli.js');

/** The tsx CLI, for the TypeScript report script. */
const TSX_CLI = path.join('node_modules', 'tsx', 'dist', 'cli.mjs');

/** Where the Pathway list is written, relative to the root (pathwayUniverse.ts reads it). */
export const PATHWAYS_LIST_FILE = path.join('audit-artifacts', '.pathways.json');

/** The report generator (task 17.1). Run only when it exists. */
const REPORT_SCRIPT = path.join('scripts', 'e2e', 'audit-report.ts');

/**
 * Playwright projects per viewport (playwright.config.ts). `preflight` and `setup` are
 * dependencies and run regardless. `isolated` is left out of a viewport subset: it
 * depends on all four viewport projects, so naming it would run the other viewport too.
 */
export const VIEWPORT_PROJECTS = {
  desktop: ['desktop', 'desktop-aux'],
  phone: ['phone', 'phone-aux'],
};

/** Pathway id shape, the same pattern the DSL validates (design "Data Models"). */
const PATHWAY_ID = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** A command-line mistake. `main` prints its message and the usage. */
export class AuditUsageError extends Error {}

export const USAGE = `Usage: npm run audit -- [options] [-- <playwright args>]

  --area <area>        run one functional area (repeatable)
  --pathway <id>       run one Pathway by id (repeatable)
  --viewport <v>       desktop | phone
  --no-build           reuse the last .next-e2e build (the stamp is still checked)
  --dry-run            print the steps and the Playwright arguments, run nothing
  --help               this text
  -- <args>            passed to playwright test unchanged`;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses the audit's own arguments. Pure.
 *
 * @param {string[]} argv arguments after the script name
 * @param {{ areas?: readonly string[] }} [known] the valid areas (`AREAS` in
 *   tests/e2e/audit/core/coverageMap.ts); when given, an unknown area is refused
 * @returns {{ build: boolean, dryRun: boolean, help: boolean, areas: string[],
 *   pathways: string[], viewport: 'desktop' | 'phone' | null, passthrough: string[] }}
 * @throws AuditUsageError on an unknown flag, a missing or invalid value
 */
export function parseAuditArgs(argv, known = {}) {
  const options = {
    build: true,
    dryRun: false,
    help: false,
    areas: [],
    pathways: [],
    viewport: null,
    passthrough: [],
  };

  const valueOf = (flag, index, inline) => {
    if (inline !== undefined) {
      if (inline === '') throw new AuditUsageError(`${flag} needs a value.`);
      return { value: inline, next: index };
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new AuditUsageError(`${flag} needs a value.`);
    return { value, next: index + 1 };
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      options.passthrough = argv.slice(i + 1);
      break;
    }
    const eq = arg.indexOf('=');
    const flag = arg.startsWith('--') && eq !== -1 ? arg.slice(0, eq) : arg;
    const inline = arg.startsWith('--') && eq !== -1 ? arg.slice(eq + 1) : undefined;

    switch (flag) {
      case '--area': {
        const { value, next } = valueOf(flag, i, inline);
        if (known.areas && !known.areas.includes(value)) {
          throw new AuditUsageError(`Unknown area "${value}". Areas: ${known.areas.join(', ')}.`);
        }
        if (!options.areas.includes(value)) options.areas.push(value);
        i = next;
        break;
      }
      case '--pathway': {
        const { value, next } = valueOf(flag, i, inline);
        if (!PATHWAY_ID.test(value)) {
          throw new AuditUsageError(`"${value}" is not a Pathway id (expected e.g. cash-sale.pay).`);
        }
        if (!options.pathways.includes(value)) options.pathways.push(value);
        i = next;
        break;
      }
      case '--viewport': {
        const { value, next } = valueOf(flag, i, inline);
        if (!Object.hasOwn(VIEWPORT_PROJECTS, value)) {
          throw new AuditUsageError(`--viewport must be desktop or phone, not "${value}".`);
        }
        if (options.viewport !== null && options.viewport !== value) {
          throw new AuditUsageError('--viewport may be given once.');
        }
        options.viewport = value;
        i = next;
        break;
      }
      case '--no-build':
        options.build = false;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--compare-isolated':
        throw new AuditUsageError('--compare-isolated is not implemented yet (task 17.3).');
      default:
        throw new AuditUsageError(
          `Unknown option "${arg}". Put Playwright arguments after a second "--".`,
        );
    }
  }
  return options;
}

/**
 * The `--grep` pattern for the selected areas and Pathways, or null for the whole
 * suite. Matches the DSL's `@area:<area>` and `@id:<id>` tags, which Playwright
 * tests against the title path and tags joined by spaces, so a name must end at a
 * space or the end: `cash-sale` must not select `cash-sale-disputes`.
 */
export function grepFor({ areas, pathways }) {
  const alternatives = [
    ...areas.map((area) => `@area:${escapeRegExp(area)}`),
    ...pathways.map((id) => `@id:${escapeRegExp(id)}`),
  ];
  if (alternatives.length === 0) return null;
  return `(?:${alternatives.join('|')})(?=\\s|$)`;
}

/** Arguments for `playwright test` (after `test`) for parsed options. Pure. */
export function playwrightTestArgs(options) {
  const args = [];
  const grep = grepFor(options);
  if (grep !== null) args.push('--grep', grep);
  if (options.viewport !== null) {
    for (const project of VIEWPORT_PROJECTS[options.viewport]) args.push(`--project=${project}`);
  }
  args.push(...options.passthrough);
  return args;
}

/**
 * The ordered steps for parsed options, as labels and argument vectors (each run with
 * `node`). Pure; `main` executes it and `--dry-run` prints it.
 */
export function planSteps(options, { reportExists = false } = {}) {
  const steps = [{ name: 'static preflight', kind: 'internal' }];
  if (options.build) {
    steps.push({ name: 'build', kind: 'node', args: [path.join('scripts', 'e2e', 'build-for-e2e.mjs')] });
  }
  steps.push({ name: 'client env stamp check', kind: 'internal' });
  steps.push({
    name: 'list pathways',
    kind: 'node',
    args: [PLAYWRIGHT_CLI, 'test', '--list', '--reporter=json'],
    stdoutTo: PATHWAYS_LIST_FILE,
  });
  steps.push({ name: 'playwright test', kind: 'node', args: [PLAYWRIGHT_CLI, 'test', ...playwrightTestArgs(options)] });
  if (reportExists) steps.push({ name: 'report', kind: 'node', args: [TSX_CLI, REPORT_SCRIPT] });
  return steps;
}

// ---------------------------------------------------------------------------------
// Execution. Everything below does I/O and is not imported by the unit tests' paths.

/**
 * Loads a TypeScript module of the harness through tsx.
 *
 * Through tsx's CJS `require`, not `tsImport`. The package has no `"type": "module"`,
 * so the harness `.ts` files load as CommonJS, and under `tsImport` (tsx 4.23) an
 * extensionless relative import inside one of them (`marker.ts` importing
 * `../audit/core/artifactPaths`) failed with "Cannot find module". The CJS loader
 * resolves those the way Playwright and Vitest do.
 */
async function loadTs(relativeFromRoot) {
  const { require: tsxRequire } = await import('tsx/cjs/api');
  return tsxRequire(path.join(ROOT, relativeFromRoot), import.meta.url);
}

/** Runs `node <args>` to completion, returning its exit code. Never through a shell. */
function runNode(args, { captureStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ['inherit', captureStdout ? 'pipe' : 'inherit', 'inherit'],
    });
    const chunks = [];
    if (captureStdout) child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.on('exit', (code, signal) =>
      resolve({ code: code ?? (signal ? 1 : 0), stdout: Buffer.concat(chunks).toString('utf8') }),
    );
  });
}

function log(message) {
  console.log(`\n[audit] ${message}`);
}

/** Runs the preflight over the harness environment; throws with every problem named. */
async function preflight({ builtClientEnv } = {}) {
  const [{ decidePreflight }, { harnessEnvironment }, { describePreflightProblem }] = await Promise.all([
    loadTs('tests/e2e/audit/core/preflight.ts'),
    loadTs('tests/e2e/audit/harnessEnv.ts'),
    loadTs('tests/e2e/audit/preflightMessages.ts'),
  ]);
  const env = harnessEnvironment(ROOT);
  const verdict = decidePreflight({
    harnessSchema: env.NEXT_PUBLIC_SUPABASE_SCHEMA?.trim() || undefined,
    env,
    builtClientEnv,
  });
  if (!verdict.ok) {
    throw new Error(
      'Preflight refused the run:\n' +
        verdict.problems.map((problem) => `  - ${describePreflightProblem(problem)}`).join('\n'),
    );
  }
}

async function main(argv) {
  const { AREAS } = await loadTs('tests/e2e/audit/core/coverageMap.ts');
  let options;
  try {
    options = parseAuditArgs(argv, { areas: AREAS });
  } catch (error) {
    if (!(error instanceof AuditUsageError)) throw error;
    console.error(`[audit] ${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const steps = planSteps(options, { reportExists: existsSync(path.join(ROOT, REPORT_SCRIPT)) });

  if (options.dryRun) {
    console.log('[audit] dry run, nothing is executed. Steps:');
    for (const [index, step] of steps.entries()) {
      const command =
        step.kind === 'node'
          ? `node ${step.args.map((a) => (/[\s|()?]/.test(a) ? `"${a}"` : a)).join(' ')}` +
            (step.stdoutTo ? ` > ${step.stdoutTo}` : '')
          : '(in process)';
      console.log(`  ${index + 1}. ${step.name}: ${command}`);
    }
    if (!steps.some((step) => step.name === 'report')) {
      console.log(`  (no report step: ${REPORT_SCRIPT} does not exist yet)`);
    }
    if (options.viewport !== null) {
      console.log('  (the isolated project is skipped for a viewport subset)');
    }
    return 0;
  }

  // The whole suite is the full run: one retry (playwright.config.ts). A filtered run
  // is the dev loop and does not retry.
  const full = options.areas.length === 0 && options.pathways.length === 0 && options.viewport === null;
  process.env.E2E_FULL_RUN = full ? '1' : '0';

  // One run id for every process from here on (support/marker.ts).
  const { runId, RUN_ID_ENV } = await loadTs('tests/e2e/support/marker.ts');
  const id = runId();
  log(`run ${id} (${RUN_ID_ENV})`);

  let playwrightCode = 0;
  for (const step of steps) {
    log(step.name);
    if (step.name === 'static preflight') {
      await preflight();
      continue;
    }
    if (step.name === 'client env stamp check') {
      const { readBuiltClientEnv } = await loadTs('tests/e2e/audit/harnessEnv.ts');
      const built = readBuiltClientEnv(ROOT);
      if (built === null) {
        throw new Error(
          options.build
            ? 'The build left no client env stamp in .next-e2e.'
            : 'There is no e2e build stamp in .next-e2e; run without --no-build.',
        );
      }
      await preflight({ builtClientEnv: built });
      continue;
    }
    if (step.stdoutTo) {
      const { code, stdout } = await runNode(step.args, { captureStdout: true });
      if (code !== 0) throw new Error(`${step.name} exited ${code}.`);
      const { pathwayIdsFromListJson } = await loadTs('tests/e2e/audit/pathwayUniverse.ts');
      const ids = pathwayIdsFromListJson(stdout); // throws on output that is not JSON
      const file = path.join(ROOT, step.stdoutTo);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, stdout);
      console.log(`[audit] ${ids.length} Pathway ids written to ${step.stdoutTo}`);
      continue;
    }
    const { code } = await runNode(step.args);
    if (step.name === 'playwright test') {
      playwrightCode = code;
      if (code !== 0) log(`playwright test exited ${code}; writing the report anyway.`);
      continue;
    }
    if (code !== 0) throw new Error(`${step.name} exited ${code}.`);
  }
  if (!steps.some((step) => step.name === 'report')) {
    log(`no report: ${REPORT_SCRIPT} does not exist yet.`);
  }
  return playwrightCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`\n[audit] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
