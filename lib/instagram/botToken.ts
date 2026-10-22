import 'server-only';

// lib/instagram/botToken.ts
//
// The Instagram DM claim bot's access token: which one to use, and keeping it alive.
//
// The bot reads NoDitto's inbox (`references.checkInstagramGraphDmForCode`) and looks
// up DM senders (`app/api/webhooks/instagram-dm`) with an Instagram API with Instagram
// Login token. That token lasts 60 days and is extended with `refresh_access_token`,
// which may return a NEW token string, so the current token lives in
// `cardtrade.instagram_bot_tokens` (0160) rather than only in the environment.
//
// THE ENVIRONMENT IS STILL THE SWITCH. `INSTAGRAM_PAGE_ACCESS_TOKEN` (or
// `INSTAGRAM_ACCESS_TOKEN`) seeds the row, and the stored token is used only while
// it descends from the CURRENT env token (`env_token_sha256`). Set a new token in
// Vercel and it wins at once; unset it and the bot is off. A manual rotation can
// therefore never be shadowed by an older stored token.
//
// The refresh is a pass of the hourly `:17` job and runs at most once a day per token
// (`INSTAGRAM_TOKEN_REFRESH_EVERY_HOURS`). Meta refuses to refresh a token younger
// than 24 hours, which is why seeding counts as a refresh.

import { createHash } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import { logBackgroundFailure } from '@/lib/errors/errorLog';

type AdminClient = ReturnType<typeof createAdminClient>;

/** Refresh a token once it is this old. Daily keeps it ~59 days from lapsing. */
export const INSTAGRAM_TOKEN_REFRESH_EVERY_HOURS = 24;

const REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';

/** The env token, or '' when the bot is not configured. */
function envToken(): string {
  return (
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN ||
    process.env.INSTAGRAM_ACCESS_TOKEN ||
    ''
  ).trim();
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** True when a token last refreshed (or seeded) at `refreshedAt` should be refreshed. */
export function isInstagramTokenRefreshDue(refreshedAt: string, now: Date = new Date()): boolean {
  const last = Date.parse(refreshedAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= INSTAGRAM_TOKEN_REFRESH_EVERY_HOURS * 3_600_000;
}

/**
 * The token the bot should call Instagram with right now, or null when none is
 * configured. Prefers the refreshed token in the database while it descends from the
 * current env token; any database failure falls back to the env token, so a missing
 * table or an outage degrades to the pre-0160 behaviour instead of stopping the bot.
 */
export async function getInstagramBotToken(): Promise<string | null> {
  const env = envToken();
  if (!env) return null;
  try {
    const { data, error } = await createAdminClient()
      .from('instagram_bot_tokens')
      .select('access_token, env_token_sha256')
      .eq('id', 1)
      .maybeSingle();
    if (!error && data && data.env_token_sha256 === sha256Hex(env)) {
      return data.access_token;
    }
  } catch {
    // Fall through to the env token.
  }
  return env;
}

export type InstagramTokenRefreshOutcome =
  | { status: 'NO_TOKEN' }
  | { status: 'SEEDED' }
  | { status: 'NOT_DUE' }
  | { status: 'REFRESHED'; expiresAt: string | null }
  | { status: 'FAILED'; errorCode: string };

/**
 * The `:17` pass. Seeds the row from the env token when there is none (or the env
 * token changed), otherwise refreshes the stored token once it is a day old.
 *
 * A provider refusal is logged as `instagram.token.refresh` and returned as FAILED;
 * `refreshed_at` is left alone so the next hour retries. Database errors throw, and
 * the job logs them as `job.trade-inspections.instagramToken`.
 */
export async function refreshInstagramBotToken(
  now: Date = new Date(),
  client: AdminClient = createAdminClient(),
): Promise<InstagramTokenRefreshOutcome> {
  const env = envToken();
  if (!env) return { status: 'NO_TOKEN' };
  const envHash = sha256Hex(env);
  const nowIso = now.toISOString();

  const { data: row, error: readError } = await client
    .from('instagram_bot_tokens')
    .select('access_token, env_token_sha256, refreshed_at')
    .eq('id', 1)
    .maybeSingle();
  if (readError) throw readError;

  if (!row || row.env_token_sha256 !== envHash) {
    const { error: seedError } = await client.from('instagram_bot_tokens').upsert(
      {
        id: 1,
        access_token: env,
        env_token_sha256: envHash,
        expires_at: null,
        refreshed_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'id' },
    );
    if (seedError) throw seedError;
    return { status: 'SEEDED' };
  }

  if (!isInstagramTokenRefreshDue(row.refreshed_at, now)) return { status: 'NOT_DUE' };

  const url = new URL(REFRESH_URL);
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', row.access_token);

  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (error) {
    await logBackgroundFailure({ name: 'instagram.token.refresh', errorCode: 'GRAPH_UNREACHABLE', error });
    return { status: 'FAILED', errorCode: 'GRAPH_UNREACHABLE' };
  }
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!res.ok || !body.access_token) {
    const errorCode = `GRAPH_${res.status}`;
    // Meta's own text names the problem (expired, revoked, too young). It never
    // echoes the token.
    await logBackgroundFailure({
      name: 'instagram.token.refresh',
      errorCode,
      message: body.error?.message ?? `Token refresh returned ${res.status} with no token`,
    });
    return { status: 'FAILED', errorCode };
  }

  const expiresAt =
    typeof body.expires_in === 'number' && body.expires_in > 0
      ? new Date(now.getTime() + body.expires_in * 1000).toISOString()
      : null;

  // Guarded on the env hash: if an operator rotated the env token mid-refresh, the
  // next run re-seeds from it rather than this write overwriting the rotation.
  const { error: writeError } = await client
    .from('instagram_bot_tokens')
    .update({
      access_token: body.access_token,
      expires_at: expiresAt,
      refreshed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', 1)
    .eq('env_token_sha256', envHash);
  if (writeError) throw writeError;

  return { status: 'REFRESHED', expiresAt };
}
