// scripts/dev/stripeListen.mjs
//
// Forward Stripe TEST-mode webhooks to the local app, one `stripe listen` per
// configured platform account (STRIPE_SECRET_KEY = AU, STRIPE_SECRET_KEY_US = the US
// platform serving US/UK/EEA/CA/CH).
//
//   npm run dev:stripe                                  forwards to http://localhost:3000
//   npm run dev:stripe -- 3100                          another port (the e2e suite's)
//   node scripts/dev/stripeListen.mjs 3100 --ready-port 3199
//                                                       also serve GET /ready: 503 until
//                                                       every listener printed `Ready!`,
//                                                       then 200 (the audit suite's third
//                                                       Playwright webServer, Req 4.5, 4.6, 26.5)
//
// Each listener signs with its own secret, stable per account and machine. The app
// accepts any secret in STRIPE_WEBHOOK_SECRET (comma-separated, see
// readWebhookSecrets), so this checks the listener secrets are in that list before
// starting, and says exactly what to add when they are not. Under --ready-port the
// output is a harness log, so that message names the accounts and never prints the
// secrets: run `npm run dev:stripe` by hand to see them.
//
// Refuses live keys: `stripe listen` against a live account would forward real
// members' events into the dev sandbox.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { loadEnv } from './lib.mjs';

/** `[port] [--ready-port <n> | --ready-port=<n>]`, in any order. */
function parseArgs(argv) {
  let port = null;
  let readyPort = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ready-port' || arg.startsWith('--ready-port=')) {
      const value = arg === '--ready-port' ? argv[++i] : arg.slice('--ready-port='.length);
      readyPort = parsePort(value, '--ready-port');
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}. Usage: stripeListen.mjs [port] [--ready-port <n>]`);
    } else if (port === null) {
      port = arg;
    } else {
      throw new Error(`Unexpected argument ${arg}. Usage: stripeListen.mjs [port] [--ready-port <n>]`);
    }
  }
  return { port: port ?? '3000', readyPort };
}

function parsePort(value, label) {
  const n = Number(value);
  if (!/^\d+$/.test(String(value ?? '')) || n < 1 || n > 65535) {
    throw new Error(`${label} needs a port number between 1 and 65535.`);
  }
  return n;
}

/** Signing secrets and API keys never reach the log, whatever the CLI prints. */
const scrub = (line) =>
  line.replace(/whsec_\w+/g, 'whsec_…').replace(/\b(sk|rk|pk)_(test|live)_\w+/g, '$1_$2_…');

const env = loadEnv();
const { port, readyPort } = parseArgs(process.argv.slice(2));
const target = `http://localhost:${port}/api/webhooks/stripe`;

const accounts = Object.keys(env)
  .filter((k) => /^STRIPE_SECRET_KEY(_[A-Z]{2})?$/.test(k) && env[k])
  .map((k) => ({ name: k, key: env[k].trim() }));

if (accounts.length === 0) throw new Error('No STRIPE_SECRET_KEY* in .env.local.');
for (const { name, key } of accounts) {
  if (!key.startsWith('sk_test_')) throw new Error(`${name} is not a sk_test_ key; refusing to forward it.`);
}

const configured = new Set(
  Object.keys(env)
    .filter((k) => /WEBHOOK_SECRET/.test(k))
    .flatMap((k) => String(env[k]).split(/[\s,]+/))
    .filter((s) => s.startsWith('whsec_')),
);

const missing = [];
for (const account of accounts) {
  account.secret = execFileSync('stripe', ['listen', '--print-secret', '--api-key', account.key], {
    encoding: 'utf8',
    shell: true,
  }).trim();
  if (!configured.has(account.secret)) missing.push(account);
}
if (missing.length > 0) {
  const names = missing.map((a) => a.name).join(', ');
  console.error(
    readyPort === null
      ? `Webhooks from ${names} would be rejected: their listener ` +
          'secret is not in STRIPE_WEBHOOK_SECRET. Append it (comma-separated) in .env.local, ' +
          'restart `npm run dev`, then run this again. The secrets:\n' +
          missing.map((a) => `  ${a.name}: ${a.secret}`).join('\n')
      : `Webhooks from ${names} would be rejected: their listener secret is not in ` +
          'STRIPE_WEBHOOK_SECRET. Run `npm run dev:stripe` in a terminal to see the secret to ' +
          'append (comma-separated) in .env.local, then start the run again.',
  );
  process.exit(1);
}

const children = [];
const ready = new Set();
const allReady = () => ready.size === accounts.length;

for (const { name, key } of accounts) {
  const child = spawn(
    'stripe',
    ['listen', '--all-snapshot', '--api-key', key, '--forward-to', target, '--forward-connect-to', target],
    { shell: true },
  );
  children.push(child);
  const tag = `[${name.replace('STRIPE_SECRET_KEY', 'AU').replace('AU_', '')}]`;
  const relay = (chunk) =>
    String(chunk)
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => {
        if (readyPort !== null && !ready.has(name) && line.includes('Ready!')) {
          ready.add(name);
          if (allReady()) console.log(`All ${accounts.length} listener(s) ready; /ready on port ${readyPort} now answers 200.`);
        }
        console.log(`${tag} ${scrub(line)}`);
      });
  child.stdout.on('data', relay);
  child.stderr.on('data', relay);
  child.on('exit', (code) => {
    console.log(`${tag} stripe listen exited (${code})`);
    if (readyPort !== null) stopChildren();
    process.exit(code ?? 1);
  });
}

if (readyPort !== null) startReadyServer(readyPort);
console.log(`Forwarding ${accounts.length} test account(s) to ${target}. Ctrl+C to stop.`);

/**
 * GET /ready: 200 once every listener has printed `Ready!`, 503 before. Bound to the
 * loopback addresses only (IPv4 and, where available, IPv6, since `localhost` can
 * resolve to either on Windows), so the probe is not reachable from the network.
 */
function startReadyServer(readyPortNumber) {
  const handler = (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/ready') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found\n');
      return;
    }
    const body = `${ready.size}/${accounts.length} listener(s) ready\n`;
    res.writeHead(allReady() ? 200 : 503, { 'content-type': 'text/plain' }).end(body);
  };
  for (const host of ['127.0.0.1', '::1']) {
    const server = createServer(handler);
    server.on('error', (err) => {
      // No IPv6 loopback on this machine is fine; anything else (port taken) is not.
      if (host === '::1' && (err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT')) return;
      console.error(`Cannot serve /ready on ${host}:${readyPortNumber}: ${err.code ?? err.message}`);
      stopChildren();
      process.exit(1);
    });
    server.listen(readyPortNumber, host);
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      stopChildren();
      process.exit(0);
    });
  }
}

/**
 * Stop every `stripe listen`. Under `shell: true` the child is the shell, so on
 * Windows the tree is killed with taskkill, or the listener outlives the harness and
 * keeps forwarding into the next run.
 */
function stopChildren() {
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      // Already gone.
    }
  }
}
