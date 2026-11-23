// scripts/dev/stripeListen.mjs
//
// Forward Stripe TEST-mode webhooks to the local app, one `stripe listen` per
// configured platform account (STRIPE_SECRET_KEY = AU, STRIPE_SECRET_KEY_US = the US
// platform serving US/UK/EEA/CA/CH).
//
//   npm run dev:stripe             forwards to http://localhost:3000
//   npm run dev:stripe -- 3100     another port (the e2e suite's)
//
// Each listener signs with its own secret, stable per account and machine. The app
// accepts any secret in STRIPE_WEBHOOK_SECRET (comma-separated, see
// readWebhookSecrets), so this checks the listener secrets are in that list before
// starting, and says exactly what to add when they are not.
//
// Refuses live keys: `stripe listen` against a live account would forward real
// members' events into the dev sandbox.
import { spawn, execFileSync } from 'node:child_process';
import { loadEnv } from './lib.mjs';

const env = loadEnv();
const port = process.argv[2] ?? '3000';
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
  console.error(
    `Webhooks from ${missing.map((a) => a.name).join(', ')} would be rejected: their listener ` +
      'secret is not in STRIPE_WEBHOOK_SECRET. Append it (comma-separated) in .env.local, ' +
      'restart `npm run dev`, then run this again. The secrets:\n' +
      missing.map((a) => `  ${a.name}: ${a.secret}`).join('\n'),
  );
  process.exit(1);
}

for (const { name, key } of accounts) {
  const child = spawn(
    'stripe',
    ['listen', '--api-key', key, '--forward-to', target, '--forward-connect-to', target],
    { shell: true },
  );
  const tag = `[${name.replace('STRIPE_SECRET_KEY', 'AU').replace('AU_', '')}]`;
  const relay = (chunk) =>
    String(chunk)
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => console.log(`${tag} ${line.replace(/whsec_\w+/g, 'whsec_…')}`));
  child.stdout.on('data', relay);
  child.stderr.on('data', relay);
  child.on('exit', (code) => {
    console.log(`${tag} stripe listen exited (${code})`);
    process.exit(code ?? 1);
  });
}
console.log(`Forwarding ${accounts.length} test account(s) to ${target}. Ctrl+C to stop.`);
