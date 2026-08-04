// scripts/purge-orphaned-uploads.ts
//
// One-off cleanup for upload objects left behind after the 2026-08-03 account
// purge. Deleting rows from `storage.objects` over SQL is blocked by
// `storage.protect_delete()` — deliberately, because it would strand the
// underlying blobs while making them invisible — so removal has to go through
// the Storage API.
//
// Uses the Storage REST endpoints over `fetch` rather than `@supabase/supabase-js`:
// the JS client constructs a Realtime client on init, which needs a native
// WebSocket and therefore Node 22+. This repo currently runs Node 20.
//
// SAFETY: only the two buckets that hold per-user uploads are touched. The
// `card-images` bucket (28,386 objects / 12 GB shared reference library) is
// refused explicitly, since it is not user-owned content.
//
// Run with:
//   npx tsx --env-file=.env.local scripts/purge-orphaned-uploads.ts

/** Buckets whose contents belonged to now-deleted accounts. */
const TARGET_BUCKETS = ['item-images', 'community-uploads'] as const;

/** Never delete from these, whatever else changes. */
const PROTECTED_BUCKETS = new Set(['card-images']);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Run with: npx tsx --env-file=.env.local scripts/purge-orphaned-uploads.ts',
  );
  process.exit(1);
}

const base = `${url.replace(/\/$/, '')}/storage/v1`;
const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  'content-type': 'application/json',
};

interface StorageEntry {
  name: string;
  id: string | null;
}

/**
 * Recursively collect every object path under `prefix` in `bucket`.
 *
 * The list endpoint is directory-shaped: entries with a null `id` are folders
 * and have to be walked. Uploads here are nested `<ownerId>/<itemId>/<n>.jpg`,
 * so listing the bucket root alone would only return owner folders.
 */
async function listAll(bucket: string, prefix = ''): Promise<string[]> {
  const res = await fetch(`${base}/object/list/${bucket}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });

  if (!res.ok) {
    throw new Error(`list ${bucket}/${prefix}: ${res.status} ${await res.text()}`);
  }

  const entries = (await res.json()) as StorageEntry[];
  const paths: string[] = [];

  for (const entry of entries) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      paths.push(...(await listAll(bucket, full)));
    } else {
      paths.push(full);
    }
  }
  return paths;
}

async function removeAll(bucket: string, paths: string[]): Promise<void> {
  // The delete endpoint caps per call; chunk to stay well inside it.
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const res = await fetch(`${base}/object/${bucket}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ prefixes: chunk }),
    });
    if (!res.ok) {
      throw new Error(`remove from ${bucket}: ${res.status} ${await res.text()}`);
    }
  }
}

async function main() {
  let removed = 0;

  for (const bucket of TARGET_BUCKETS) {
    if (PROTECTED_BUCKETS.has(bucket)) {
      throw new Error(`Refusing to purge protected bucket: ${bucket}`);
    }

    const paths = await listAll(bucket);
    if (paths.length === 0) {
      console.log(`${bucket}: already empty`);
      continue;
    }

    await removeAll(bucket, paths);
    removed += paths.length;
    console.log(`${bucket}: removed ${paths.length} object(s)`);
  }

  console.log(`\nDone. ${removed} object(s) removed.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
