// scripts/copy-demo-seed-images.mjs
//
// Copy the card scans the DEMO seeds reference into this project's own `item-images`
// bucket, under a `demo-seed/` prefix.
//
// WHY THIS EXISTS
// ---------------
// `seed_marketplace.sql` and `seed_demo_kitsunearia.sql` used to build absolute image
// URLs against the `card-images` bucket of the Pokedle project, because the marketplace
// shared a Supabase project with that app. Two problems with that:
//
//   1. The demo catalogue broke the moment the marketplace moved to its own project, and
//      would break permanently once Pokedle is closed.
//   2. It hardcoded one project's ref into checked-in SQL, so the seeds could only ever
//      populate one environment.
//
// The seeds now store RELATIVE object paths (`demo-seed/<folder>/front.jpg`), which
// `itemImageUrl()` resolves against whatever `NEXT_PUBLIC_SUPABASE_URL` is set to. This
// script puts the objects where those paths expect them.
//
// Missing objects are not fatal: `itemImageUrl` still returns a URL and the UI renders a
// placeholder, so a partial copy degrades rather than breaking the seed.
//
// Reads the TARGET (url + service key) from .env.local. The SOURCE is passed in, because
// it is a bucket on a project that is being retired — once it is gone this script cannot
// run, and by then the objects live here.
//
// Usage:
//   node scripts/copy-demo-seed-images.mjs \
//     --from https://<oldref>.supabase.co/storage/v1/object/public/card-images
//   node scripts/copy-demo-seed-images.mjs --from <url> --dry-run

import { readFileSync } from 'node:fs';

const SEED_FILES = [
  'supabase/seed_marketplace.sql',
  'supabase/seed_demo_kitsunearia.sql',
];
const PREFIX = 'demo-seed';
const BUCKET = 'item-images';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

function loadEnv(path = '.env.local') {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Every object path the demo seeds reference.
 *
 * The seeds name only `front.jpg` and derive the back by string replacement, so the back
 * is inferred here the same way rather than being listed twice.
 */
function referencedPaths() {
  const found = new Set();
  for (const file of SEED_FILES) {
    const sql = readFileSync(file, 'utf8');
    for (const m of sql.matchAll(/'([^']+\/front\.jpg)'/g)) {
      found.add(m[1]);
      found.add(m[1].replace('front.jpg', 'back.jpg'));
    }
  }
  if (found.size === 0) {
    throw new Error(
      'No image paths found in the demo seeds. Refusing to continue rather than report success for doing nothing.',
    );
  }
  return [...found].sort();
}

const args = parseArgs(process.argv.slice(2));
const from = args.from;
const dryRun = Boolean(args['dry-run']);

if (!from) {
  console.error('usage: node scripts/copy-demo-seed-images.mjs --from <public-bucket-url> [--dry-run]');
  process.exit(1);
}

const env = loadEnv();
const targetUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!targetUrl || !serviceKey) {
  console.error('.env.local needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const paths = referencedPaths();
console.log(`${paths.length} object(s) referenced by the demo seeds`);
console.log(`source: ${from}`);
console.log(`target: ${targetUrl} -> ${BUCKET}/${PREFIX}/`);
console.log(dryRun ? 'mode  : DRY RUN\n' : 'mode  : COPY\n');

let copied = 0;
let absent = 0;
let failed = 0;

for (const path of paths) {
  if (dryRun) {
    console.log(`would copy ${path}`);
    continue;
  }

  let body;
  let contentType = 'image/jpeg';
  try {
    const res = await fetch(`${from.replace(/\/+$/, '')}/${path}`);
    if (res.status === 404 || res.status === 400) {
      absent += 1;
      continue;
    }
    if (!res.ok) {
      console.error(`GET  ${path} -> HTTP ${res.status}`);
      failed += 1;
      continue;
    }
    contentType = res.headers.get('content-type') ?? contentType;
    body = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error(`GET  ${path} -> ${err.message}`);
    failed += 1;
    continue;
  }

  try {
    const put = await fetch(
      `${targetUrl}/storage/v1/object/${BUCKET}/${PREFIX}/${path}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body,
      },
    );
    if (!put.ok) {
      console.error(`PUT  ${path} -> HTTP ${put.status} ${(await put.text()).slice(0, 200)}`);
      failed += 1;
      continue;
    }
    copied += 1;
  } catch (err) {
    console.error(`PUT  ${path} -> ${err.message}`);
    failed += 1;
  }
}

console.log(
  `\n${dryRun ? 'Dry run' : 'Done'}: ${copied} copied, ${absent} absent at source, ${failed} failed.`,
);
if (failed > 0) process.exit(1);
