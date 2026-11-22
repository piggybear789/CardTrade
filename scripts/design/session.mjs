// Sign a browser in as an existing member for visual review, without a password.
//
// Uses the service role to mint a one-time magic-link token (nothing is emailed, no
// password changes), redeems it through the app's own `/auth/confirm` route, and saves
// the cookie jar to `playwright/.auth/design-<name>.json` (git-ignored). Prints neither
// the email address nor the token.
//
//   node --env-file=.env.local scripts/design/session.mjs <display_name> [baseUrl]
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import WebSocket from 'ws';

// supabase-js insists on a WebSocket even though this never opens Realtime; Node 20 has none.
if (!('WebSocket' in globalThis)) globalThis.WebSocket = WebSocket;

const [displayName, base = 'http://localhost:3000'] = process.argv.slice(2);
if (!displayName) throw new Error('usage: session.mjs <display_name> [baseUrl]');

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'cardtrade' },
});

const { data: profile, error: profileError } = await admin
  .from('profiles')
  .select('id')
  .eq('display_name', displayName)
  .maybeSingle();
if (profileError || !profile) throw new Error(`no profile named ${displayName}`);

const { data: user, error: userError } = await admin.auth.admin.getUserById(profile.id);
if (userError || !user?.user?.email) throw new Error('could not read the auth user');

const { data: link, error: linkError } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: user.user.email,
});
if (linkError || !link?.properties?.hashed_token) throw new Error('could not mint a link');

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page
  .goto(`${base}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=magiclink&next=/`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  })
  .catch(() => {});
await page.goto(`${base}/profile`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
const signedIn = !/\/sign-in/.test(page.url());
mkdirSync('playwright/.auth', { recursive: true });
const path = `playwright/.auth/design-${displayName}.json`;
await context.storageState({ path });
console.log(signedIn ? `signed in as ${displayName} -> ${path}` : `sign-in FAILED for ${displayName} (landed on ${new URL(page.url()).pathname})`);
await browser.close();
