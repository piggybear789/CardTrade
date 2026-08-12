// scripts/apply-0085.mjs
// One-shot: add social_links column to profiles
// Run: npx tsx --env-file=.env.local scripts/apply-0085.mjs

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Use the Supabase Management API SQL endpoint directly
const sql = `alter table cardtrade.profiles add column if not exists social_links jsonb default '{}'::jsonb;`;

const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, {
  method: 'POST',
  headers: {
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  },
});

// The REST API won't run DDL. Try using the query approach through the SQL editor API
// Actually the simplest path: just check if the column already exists
const { data, error } = await supabase
  .from('profiles')
  .select('social_links')
  .limit(1);

if (error && error.message.includes('social_links')) {
  console.log('Column does not exist yet. Please run this SQL in your Supabase SQL Editor:');
  console.log('');
  console.log(sql);
  console.log('');
} else {
  console.log('✅ social_links column already exists on profiles');
}
