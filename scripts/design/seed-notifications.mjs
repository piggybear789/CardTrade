// Give a sandbox member a realistic spread of notifications for visual review of the
// Activity page and the bell. DEV SANDBOX ONLY: refuses unless the configured schema is
// `cardtrade_dev`. Re-running replaces the rows it added before (tagged by link suffix).
//   node --env-file=.env.local scripts/design/seed-notifications.mjs <display_name>
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

if (!('WebSocket' in globalThis)) globalThis.WebSocket = WebSocket;
const schema = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA;
if (schema !== 'cardtrade_dev') throw new Error(`refusing to seed into schema ${schema}`);

const name = process.argv[2];
if (!name) throw new Error('usage: seed-notifications.mjs <display_name>');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  db: { schema },
});

const { data: me, error } = await db.from('profiles').select('id').eq('display_name', name).single();
if (error || !me) throw new Error(`no profile named ${name}`);
const { data: items } = await db.from('items').select('id,title,image_paths').limit(4);
const item = (i) => items?.[i % (items?.length || 1)] ?? null;
const TAG = '#design-seed';

await db.from('notifications').delete().eq('user_id', me.id).like('link', `%${TAG}`);

const hour = 3600_000;
const at = (h) => new Date(Date.now() - h * hour).toISOString();
const row = (h, type, title, i, extra = {}) => ({
  user_id: me.id,
  type,
  title,
  link: `/listings/${item(i)?.id ?? ''}${TAG}`,
  subject_title: item(i)?.title ?? null,
  image_path: item(i)?.image_paths?.[0] ?? null,
  created_at: at(h),
  ...extra,
});

const rows = [
  row(0.3, 'OFFER', 'New offer on your listing', 0, { actor_name: 'Bob Carter', amount_cents: 22000, currency: 'aud' }),
  row(2, 'SALE', 'Payment received', 1, { actor_name: 'Carol Diaz', amount_cents: 25810, currency: 'aud' }),
  row(5, 'TRADE', 'Trade offer received', 2, { actor_name: 'Dave Ellis' }),
  row(30, 'SALE', 'Item shipped', 3, { actor_name: 'Erin Frost', read_at: at(20) }),
  row(80, 'OFFER', 'Your offer was declined', 1, { actor_name: 'Bob Carter', amount_cents: 18000, currency: 'aud', read_at: at(70) }),
  row(200, 'SYSTEM', 'You received a reference', 0, { body: 'Bob Carter referenced you: bought from them on Instagram.', subject_title: null, image_path: null, read_at: at(190) }),
  row(900, 'TRADE', 'Trade completed', 2, { actor_name: 'Dave Ellis', read_at: at(890) }),
];
const { error: insertError } = await db.from('notifications').insert(rows);
if (insertError) throw insertError;
console.log(`seeded ${rows.length} notifications for ${name}`);
