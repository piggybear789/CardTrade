// scripts/socialcrawl-quickstart.ts
//
// First calls against SocialCrawl (https://www.socialcrawl.dev), following its quickstart:
// check the key and balance, read one handle on four platforms, then page through one list
// endpoint until it says there is nothing more.
//
// The key is read from SOCIALCRAWL_API_KEY (`.env.local`, git-ignored) and only ever sent in
// the `x-api-key` header. Errors are branched on `error.type`; only the five transient types
// SocialCrawl documents are retried.
//
//   npx tsx --env-file=.env.local scripts/socialcrawl-quickstart.ts

const BASE = 'https://www.socialcrawl.dev/v1';
const KEY = process.env.SOCIALCRAWL_API_KEY;
if (!KEY) throw new Error('Missing SOCIALCRAWL_API_KEY. Add it to .env.local.');

/** The five error types SocialCrawl says are worth a retry. Everything else fails the same way again. */
const RETRYABLE = new Set(['RATE_LIMITED', 'CONCURRENCY_LIMIT', 'UPSTREAM_ERROR', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR']);

interface Envelope<T> {
  success: boolean;
  platform?: string;
  endpoint?: string;
  data?: T;
  credits_used?: number;
  credits_remaining?: number;
  request_id?: string;
  cached?: boolean;
  pagination?: { next_cursor: string | null; has_more: boolean; page_size?: number; next_page_credits?: number };
  error?: { type: string; message: string; status?: number; doc_url?: string };
}

class SocialCrawlError extends Error {
  constructor(readonly type: string, message: string, readonly requestId?: string) {
    super(`${type}: ${message}`);
  }
}

async function call<T>(path: string, params: Record<string, string> = {}): Promise<Envelope<T>> {
  const url = new URL(`${BASE}/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  // One idempotency key per logical request, reused on every retry, so a retried call
  // that had in fact succeeded is never billed twice.
  const idempotencyKey = crypto.randomUUID();
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { 'x-api-key': KEY!, 'Idempotency-Key': idempotencyKey } });
    const body = (await response.json()) as Envelope<T>;
    if (body.success) return body;
    const type = body.error?.type ?? 'UNKNOWN';
    if (RETRYABLE.has(type) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
      continue;
    }
    throw new SocialCrawlError(type, body.error?.message ?? `HTTP ${response.status}`, body.request_id);
  }
}

interface ProfileData {
  author?: { username?: string; followers?: number | null };
}
interface PostList {
  items?: { post?: { id?: string; url?: string; published_at?: string; content?: { text?: string } } }[];
}

async function quickstart(): Promise<void> {
  // 1. The key works, and what it has left (0 credits).
  const balance = await call<Record<string, unknown>>('credits/balance');
  console.log('1. balance:', JSON.stringify(balance.data));

  // 2. One profile.
  const tiktok = await call<ProfileData>('tiktok/profile', { handle: 'charlidamelio' });
  console.log(`2. tiktok/profile followers=${tiktok.data?.author?.followers} credits_used=${tiktok.credits_used}`);

  // 3. The same handle elsewhere: only the path changes.
  for (const path of ['instagram/profile', 'youtube/channel', 'twitter/profile']) {
    try {
      const res = await call<ProfileData>(path, { handle: 'charlidamelio' });
      console.log(
        `3. ${path.padEnd(18)} followers=${res.data?.author?.followers ?? 'n/a'} ` +
          `credits_used=${res.credits_used} cached=${res.cached} left=${res.credits_remaining}`,
      );
    } catch (error) {
      console.log(`3. ${path.padEnd(18)} ${error instanceof SocialCrawlError ? error.message : String(error)}`);
    }
  }

  // 4. One list endpoint, paged to the end. Instagram profile posts are 1 credit a page;
  // @byedrifloon has a handful of posts, including the reference post the crawler reads.
  let cursor: string | null = null;
  let page = 0;
  let rows = 0;
  let spent = 0;
  do {
    const res: Envelope<PostList> = await call<PostList>('instagram/profile/posts', {
      handle: 'byedrifloon',
      ...(cursor ? { cursor } : {}),
    });
    page++;
    const items = res.data?.items ?? [];
    rows += items.length;
    spent += res.credits_used ?? 0;
    console.log(
      `4. page ${page}: ${items.length} posts, credits_used=${res.credits_used}, has_more=${res.pagination?.has_more}, ` +
        `next_page_credits=${res.pagination?.next_page_credits ?? '-'}, left=${res.credits_remaining}`,
    );
    for (const item of items) {
      const text = (item.post?.content?.text ?? '').replace(/\s+/g, ' ').slice(0, 70);
      console.log(`     ${item.post?.published_at?.slice(0, 10) ?? '?'} ${item.post?.url ?? ''} ${text}`);
    }
    cursor = res.pagination?.has_more ? (res.pagination.next_cursor ?? null) : null;
  } while (cursor && page < 10);
  console.log(`4. done: ${rows} posts over ${page} page(s), ${spent} credits.`);
}

quickstart().catch((error: unknown) => {
  if (error instanceof SocialCrawlError) {
    console.error(`SocialCrawl ${error.type} (request ${error.requestId ?? '?'}): ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});

// A module, so its top-level names don't collide with the other scripts' in `tsc`.
export {};
