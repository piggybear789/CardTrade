import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
globalThis.WebSocket ??= WebSocket;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, db: { schema: process.env.NEXT_PUBLIC_SUPABASE_SCHEMA } });
const [s,t,c,p,i,n] = await Promise.all([
  db.from('cash_sales').select('id,status,buyer_id,seller_id').limit(10),
  db.from('trades').select('id,state,initiator_id,counterpart_id').limit(10),
  db.from('conversations').select('id,participant_a,participant_b').limit(5),
  db.from('profiles').select('id,display_name').limit(12),
  db.from('items').select('id,title,owner_id,listing_kind,status').limit(8),
  db.from('notifications').select('profile_id').limit(50),
]);
console.log(JSON.stringify({s:s.data,t:t.data,c:c.data,p:p.data,i:i.data, n: n.data?.length, err:[s.error,t.error,c.error,n.error].filter(Boolean)}, null, 0));
