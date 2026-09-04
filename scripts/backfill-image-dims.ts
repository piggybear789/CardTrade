// scripts/backfill-image-dims.ts
//
// One-off backfill for `items.image_dims` (migration 0106), which stores the
// intrinsic pixel size of every listing photo so the phone catalog mosaic can
// reserve the right shape before the image loads.
//
// Rows created from now on get their dimensions at upload time. Rows that
// already existed have none, and a tile with no stored size falls back to a
// square — correct, but it flattens the mosaic. This walks those rows, reads
// each photo's header, and fills the column in.
//
// IT DOES NOT DOWNLOAD THE PHOTOS. Each object is fetched with an HTTP Range
// request for its first 128 KB, which is all the header parser in
// `lib/images/header.ts` needs. Over a catalog of tens of thousands of photos
// that is the difference between a few hundred megabytes and a few hundred
// gigabytes. A server that ignores the Range header and starts sending the
// whole file is cut off after the same 128 KB.
//
// RESUMABLE AND IDEMPOTENT. The default pass selects only rows where
// `image_dims IS NULL` and writes an array to every row it touches — an array
// of nulls if nothing could be read — so a processed row is never reconsidered
// and an interrupted run picks up exactly where it stopped. Re-running when
// there is nothing left is a single query that returns no rows.
//
// Uses the REST endpoints over `fetch` rather than `@supabase/supabase-js`, for
// the same reason as `purge-orphaned-uploads.ts`: the JS client constructs a
// Realtime client on init, which needs a native WebSocket and therefore
// Node 22+. This repo currently runs Node 20.
//
// Run with:
//   npx tsx --env-file=.env.local scripts/backfill-image-dims.ts
//
// Options:
//   --dry-run        Read and report, write nothing.
//   --limit N        Stop after N rows (default: no limit).
//   --batch N        Rows fetched per query (default 200).
//   --concurrency N  Photos fetched at once (default 8).
//   --recheck        Revisit rows that already have a value, oldest id first,
//                    for when a decoder improves. Resume a stopped recheck with
//                    `--after <last-id-printed>`.
//   --after UUID     Keyset cursor for --recheck.
//
// NOT FOR PRODUCTION WITHOUT A LOOK FIRST. It writes with the service-role key
// and bypasses RLS. Point it at a staging project, read the summary, and only
// then decide.

import {
  sanitizeImageDim,
  type ImageDim,
} from '../lib/images/dimensions';
import {
  HEADER_PROBE_BYTES,
  readImageHeaderDimensions,
} from '../lib/images/header';

const ITEM_IMAGES_BUCKET = 'item-images';
const REQUEST_TIMEOUT_MS = 20_000;

interface Options {
  dryRun: boolean;
  limit: number;
  batch: number;
  concurrency: number;
  recheck: boolean;
  after: string | null;
}

function parseArgs(argv: string[]): Options {
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? null : (argv[at + 1] ?? null);
  };
  const int = (name: string, fallback: number) => {
    const raw = value(name);
    const parsed = raw == null ? NaN : Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    dryRun: flag('dry-run'),
    limit: int('limit', Number.POSITIVE_INFINITY),
    batch: int('batch', 200),
    concurrency: int('concurrency', 8),
    recheck: flag('recheck'),
    after: value('after'),
  };
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Run with: npx tsx --env-file=.env.local scripts/backfill-image-dims.ts',
  );
  process.exit(1);
}

const base = url.replace(/\/$/, '');
const restHeaders = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  // `items` lives in the `cardtrade` schema, not `public`.
  'accept-profile': 'cardtrade',
  'content-profile': 'cardtrade',
  'content-type': 'application/json',
};

interface ItemRow {
  id: string;
  image_paths: string[] | null;
}

/**
 * Resolve a stored value to something fetchable. Mirrors `itemImageUrl()` in
 * `lib/format.ts`: an absolute URL is an external reference (seeded catalog
 * rows point at remote card scans) and is used as-is; anything else is an
 * object path in the public item-images bucket.
 */
function publicUrlFor(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}/storage/v1/object/public/${ITEM_IMAGES_BUCKET}/${path.replace(/^\/+/, '')}`;
}

/**
 * Read at most `max` bytes of a response body, then hang up.
 *
 * Storage honours Range and replies 206 with just the slice, but an external
 * host — and these rows do contain external hosts — may ignore it and start
 * streaming a 12 MB scan. Cancelling the reader closes that connection instead
 * of paying for the rest of a file we have already read the header of.
 */
async function readCapped(response: Response, max: number): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    const room = Math.min(chunk.length, total - at);
    out.set(chunk.subarray(0, room), at);
    at += room;
  }
  return out;
}

/**
 * Intrinsic size of one stored photo, or `null` for anything that cannot be
 * read: a 404 from a purged object, a dead external host, a timeout, a format
 * the parser does not cover. Never throws — one bad photo must not abandon the
 * other nine on the same listing, let alone the run.
 */
async function probe(path: string): Promise<ImageDim | null> {
  try {
    const response = await fetch(publicUrlFor(path), {
      headers: { range: `bytes=0-${HEADER_PROBE_BYTES - 1}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!response.ok) return null;
    const bytes = await readCapped(response, HEADER_PROBE_BYTES);
    return sanitizeImageDim(readImageHeaderDimensions(bytes));
  } catch {
    return null;
  }
}

/** Run `task` over `items` with at most `limit` in flight. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

async function fetchBatch(options: Options, after: string | null): Promise<ItemRow[]> {
  const params = new URLSearchParams({
    select: 'id,image_paths',
    limit: String(options.batch),
  });

  if (options.recheck) {
    // No natural cursor once every row has a value, so page on the primary key.
    params.set('order', 'id.asc');
    if (after) params.set('id', `gt.${after}`);
  } else {
    // The filter IS the cursor: every row we write stops matching.
    params.set('image_dims', 'is.null');
    params.set('order', 'created_at.asc');
  }

  const response = await fetch(`${base}/rest/v1/items?${params}`, {
    headers: restHeaders,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`select items: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as ItemRow[];
}

async function writeDims(id: string, dims: (ImageDim | null)[]): Promise<void> {
  const response = await fetch(
    `${base}/rest/v1/items?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { ...restHeaders, prefer: 'return=minimal' },
      body: JSON.stringify({ image_dims: dims }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`update ${id}: ${response.status} ${await response.text()}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log(`Target : ${new URL(base).host}`);
  console.log(
    `Mode   : ${options.recheck ? 'recheck every row' : 'rows with no dimensions yet'}` +
      `${options.dryRun ? ' (dry run — nothing will be written)' : ''}`,
  );
  console.log('');

  let rowsSeen = 0;
  let rowsWritten = 0;
  let photosRead = 0;
  let photosUnreadable = 0;
  let cursor = options.after;

  for (;;) {
    if (rowsSeen >= options.limit) break;

    const rows = await fetchBatch(options, cursor);
    if (rows.length === 0) break;

    for (const row of rows) {
      if (rowsSeen >= options.limit) break;
      rowsSeen += 1;
      cursor = row.id;

      const paths = row.image_paths ?? [];
      const dims = await mapWithConcurrency(paths, options.concurrency, probe);
      photosRead += dims.filter((dim) => dim !== null).length;
      photosUnreadable += dims.filter((dim) => dim === null).length;

      if (!options.dryRun) {
        await writeDims(row.id, dims);
        rowsWritten += 1;
      }

      if (rowsSeen % 50 === 0) {
        console.log(
          `  ${rowsSeen} rows — ${photosRead} photos measured, ${photosUnreadable} unreadable (last id ${row.id})`,
        );
      }
    }

    // The default pass relies on each written row dropping out of the filter.
    // If a batch wrote nothing, the same rows come back forever, so stop rather
    // than spin — a dry run is the expected way to reach this.
    if (!options.recheck && options.dryRun) break;
  }

  console.log('');
  console.log(`Rows examined   : ${rowsSeen}`);
  console.log(`Rows written    : ${rowsWritten}${options.dryRun ? ' (dry run)' : ''}`);
  console.log(`Photos measured : ${photosRead}`);
  console.log(`Photos unknown  : ${photosUnreadable}`);
  if (options.recheck && cursor) {
    console.log(`Resume with     : --recheck --after ${cursor}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
