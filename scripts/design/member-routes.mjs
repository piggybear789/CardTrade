// Print the signed-in routes worth reviewing for one member: their contract rooms,
// listings and threads, as ids only. Read-only.
//   node --env-file=.env.local scripts/design/member-routes.mjs <display_name>
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

if (!('WebSocket' in globalThis)) globalThis.WebSocket = WebSocket;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'cardtrade' },
});
const name = process.argv[2];
const { data: me } = await db.from('profiles').select('id').eq('display_name', name).single();
const id = me.id;
const [sales, trades, convs, items] = await Promise.all([
  db.from('cash_sales').select('id,status').or(`seller_id.eq.${id},buyer_id.eq.${id}`).limit(3),
  db.from('trades').select('id,state').or(`initiator_id.eq.${id},counterpart_id.eq.${id}`).limit(3),
  db.from('conversations').select('id').or(`participant_a.eq.${id},participant_b.eq.${id}`).limit(2),
  db.from('items').select('id,status').eq('owner_id', id).limit(2),
]);
const routes = [
  ...(sales.data ?? []).map((s) => `/sales/${s.id}`),
  ...(trades.data ?? []).map((t) => `/trades/${t.id}`),
  ...(convs.data ?? []).map((c) => `/messages/${c.id}`),
  ...(items.data ?? []).map((i) => `/listings/${i.id}/edit`),
];
console.log(JSON.stringify(routes));
