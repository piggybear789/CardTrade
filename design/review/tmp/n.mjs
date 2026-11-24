import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
globalThis.WebSocket ??= WebSocket;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, db: { schema: process.env.NEXT_PUBLIC_SUPABASE_SCHEMA } });
const { data, error } = await db.from('notifications').select('id,user_id,type,created_at').eq('user_id','11111111-1111-1111-1111-111111111111');
console.log(JSON.stringify({ n: data?.length, error, first: data?.[0] }));
