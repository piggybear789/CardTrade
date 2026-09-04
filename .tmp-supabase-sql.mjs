// Temporary helper: run one SQL file (or inline --sql) against the linked
// Supabase project via the Management API. Deleted after use.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.trimStart().startsWith('#') && line.includes('='))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

const token = env.SUPABASE_PAT;
if (!token) throw new Error('SUPABASE_PAT missing from .env.local');

const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];

const sqlArgIndex = process.argv.indexOf('--sql');
const query =
  sqlArgIndex !== -1
    ? process.argv[sqlArgIndex + 1]
    : readFileSync(process.argv[2], 'utf8');

const response = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/database/query`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  },
);

const text = await response.text();
console.log(`project: ${ref}`);
console.log(`status: ${response.status} ${response.statusText}`);
console.log(text.slice(0, 4000));
if (!response.ok) process.exitCode = 1;
