// scripts/e2e/scrubbed-server.mjs
//
// Runs one of the audit suite's `webServer` commands and relays its output through
// `scrubText` (tests/e2e/audit/core/mask.ts) before Playwright prints it (Req 32.1).
//
//   node scripts/e2e/scrubbed-server.mjs npx next start -p 3100
//
// WHY A WRAPPER. Playwright copies a web server's stdout and stderr to its own output
// verbatim, with no hook to rewrite a line, and those lines end up in CI logs and
// terminal scrollback. `next start` and `stripe listen` can print a key, a client
// secret or a member's email in an error, so the command runs as this script's child
// and every line passes through the scrubber first.
//
// The secrets scrubbed are the values the CHILD can see: the `.env*` files Next loads
// for a production server, with the real environment on top. The files are parsed
// into a local object only; the child gets this process's environment unchanged and
// loads the files itself, exactly as it would without the wrapper.
//
// Exits with the child's code, and stops the child when it is stopped. Playwright
// ends a web server by killing its process tree, which covers the child as well.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { register } from 'tsx/cjs/api';

const ROOT = process.cwd();
const ENV_FILES = ['.env', '.env.production', '.env.local', '.env.production.local'];

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error('Usage: node scripts/e2e/scrubbed-server.mjs <command> [args...]');
  process.exit(2);
}

/** The environment the child will run with: env files, then the real environment. */
function childEnvironment() {
  const fromFiles = {};
  for (const file of ENV_FILES) {
    const full = path.join(ROOT, file);
    if (existsSync(full)) Object.assign(fromFiles, parseEnv(readFileSync(full, 'utf8')));
  }
  return { ...fromFiles, ...process.env };
}

// Loaded through tsx's CommonJS hook: the repo's `.ts` files are CommonJS here (no
// `"type": "module"`), and mask.ts imports `./preflight` without an extension, which
// only `require` resolves.
register();
const { scrubText, secretValues } = createRequire(import.meta.url)('../../tests/e2e/audit/core/mask.ts');
const secrets = secretValues(childEnvironment());
const scrub = (line) => scrubText(line, secrets, {});

/** Relays `source` to `target` line by line, scrubbing each complete line. */
function relay(source, target) {
  let pending = '';
  source.setEncoding('utf8');
  source.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) target.write(`${scrub(line)}\n`);
  });
  source.on('end', () => {
    if (pending !== '') target.write(`${scrub(pending)}\n`);
    pending = '';
  });
}

const child = spawn(command.join(' '), {
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});
relay(child.stdout, process.stdout);
relay(child.stderr, process.stderr);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on('error', (error) => {
  console.error(scrub(`scrubbed-server: could not start the command: ${error.message}`));
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
