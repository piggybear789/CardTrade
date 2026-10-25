import { createHash, createHmac, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { identityStartHref } from '@/lib/identity/identityStart';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isValidClaimHandle } from '@/domain/references/reference';
import { normalizeHandle } from '@/domain/social/socialLinks';

// app/api/oauth/claim/[provider]/route.ts
//
// Direct OAuth2 Authorization Code (+ PKCE) flow for claiming social accounts
// (`discord`, `x`, `instagram`, `facebook`, `tiktok`, `ebay`).

export type ClaimOAuthProviderSlug =
  | 'discord'
  | 'x'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'ebay';

const COOKIE_NAME = 'noditto_claim_oauth';
const COOKIE_MAX_AGE_SECONDS = 600;

interface ClaimStatePayload {
  nonce: string;
  verifier: string;
  handleNorm: string;
  userId: string | null;
  provider: ClaimOAuthProviderSlug;
  returnPath: string;
}

function secretKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'noditto-dev-secret'
  );
}

function signState(payload: ClaimStatePayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secretKey()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyState(token: string | undefined | null): ClaimStatePayload | null {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = createHmac('sha256', secretKey()).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as ClaimStatePayload;
  } catch {
    return null;
  }
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function resolveOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (forwardedHost) {
    const proto =
      request.headers.get('x-forwarded-proto') ??
      (forwardedHost.startsWith('localhost') || forwardedHost.startsWith('127.0.0.1')
        ? 'http'
        : 'https');
    return `${proto}://${forwardedHost}`;
  }
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return request.nextUrl.origin;
}

function directProviderCreds(provider: ClaimOAuthProviderSlug): {
  clientId: string;
  clientSecret: string;
} | null {
  switch (provider) {
    case 'discord': {
      const clientId = process.env.DISCORD_CLIENT_ID?.trim();
      const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
      return clientId && clientSecret ? { clientId, clientSecret } : null;
    }
    case 'x': {
      const clientId = (process.env.TWITTER_CLIENT_ID ?? process.env.X_CLIENT_ID)?.trim();
      const clientSecret = (process.env.TWITTER_CLIENT_SECRET ?? process.env.X_CLIENT_SECRET)?.trim();
      return clientId && clientSecret ? { clientId, clientSecret } : null;
    }
    case 'instagram': {
      const clientId = (process.env.INSTAGRAM_CLIENT_ID ?? process.env.FACEBOOK_CLIENT_ID)?.trim();
      const clientSecret = (
        process.env.INSTAGRAM_CLIENT_SECRET ?? process.env.FACEBOOK_CLIENT_SECRET
      )?.trim();
      return clientId && clientSecret ? { clientId, clientSecret } : null;
    }
    case 'facebook': {
      const clientId = (process.env.FACEBOOK_CLIENT_ID ?? process.env.META_CLIENT_ID)?.trim();
      const clientSecret = (
        process.env.FACEBOOK_CLIENT_SECRET ?? process.env.META_CLIENT_SECRET
      )?.trim();
      return clientId && clientSecret ? { clientId, clientSecret } : null;
    }
    case 'tiktok': {
      const clientId = (process.env.TIKTOK_CLIENT_KEY ?? process.env.TIKTOK_CLIENT_ID)?.trim();
      const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
      return clientId && clientSecret ? { clientId, clientSecret } : null;
    }
    case 'ebay': {
      const clientId = (process.env.EBAY_CLIENT_ID ?? process.env.EBAY_APP_ID)?.trim();
      const clientSecret = (process.env.EBAY_CLIENT_SECRET ?? process.env.EBAY_CERT_ID)?.trim();
      return clientId && clientSecret ? { clientId, clientSecret } : null;
    }
  }
}

function buildAuthorizeUrl(
  provider: ClaimOAuthProviderSlug,
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  switch (provider) {
    case 'discord': {
      const url = new URL('https://discord.com/oauth2/authorize');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'identify');
      url.searchParams.set('state', state);
      url.searchParams.set('prompt', 'consent');
      return url.toString();
    }
    case 'x': {
      const url = new URL('https://twitter.com/i/oauth2/authorize');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', 'users.read tweet.read');
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return url.toString();
    }
    case 'instagram': {
      if (process.env.INSTAGRAM_CLIENT_ID?.trim()) {
        const url = new URL('https://www.instagram.com/oauth/authorize');
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', 'instagram_business_basic');
        url.searchParams.set('state', state);
        return url.toString();
      }
      const url = new URL('https://www.facebook.com/v20.0/dialog/oauth');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'public_profile');
      url.searchParams.set('state', state);
      return url.toString();
    }
    case 'facebook': {
      const url = new URL('https://www.facebook.com/v20.0/dialog/oauth');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'public_profile');
      url.searchParams.set('state', state);
      return url.toString();
    }
    case 'tiktok': {
      const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
      url.searchParams.set('client_key', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'user.info.basic');
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return url.toString();
    }
    case 'ebay': {
      const url = new URL('https://auth.ebay.com/oauth2/authorize');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', process.env.EBAY_RU_NAME?.trim() || redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly');
      url.searchParams.set('state', state);
      return url.toString();
    }
  }
}

async function fetchVerifiedHandles(
  provider: ClaimOAuthProviderSlug,
  code: string,
  redirectUri: string,
  verifier: string,
  creds: { clientId: string; clientSecret: string },
): Promise<string[]> {
  if (provider === 'discord') {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) return [];
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return [];
    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!meRes.ok) return [];
    // `username` only. `global_name` is a free-text display name anyone can set to
    // anything, so it proves nothing about a handle.
    const me = (await meRes.json()) as { username?: string };
    return verifiedUsernames([me.username]);
  }

  if (provider === 'x') {
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: creds.clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });
    if (!tokenRes.ok) return [];
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return [];
    const meRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!meRes.ok) return [];
    // `username` only; `name` is the display name.
    const me = (await meRes.json()) as { data?: { username?: string } };
    return verifiedUsernames([me.data?.username]);
  }

  if (provider === 'instagram' && process.env.INSTAGRAM_CLIENT_ID) {
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });
    if (!tokenRes.ok) return [];
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return [];
    const meUrl = new URL('https://graph.instagram.com/me');
    meUrl.searchParams.set('fields', 'id,username');
    meUrl.searchParams.set('access_token', tokenJson.access_token);
    const meRes = await fetch(meUrl);
    if (!meRes.ok) return [];
    const me = (await meRes.json()) as { username?: string };
    return me.username ? [me.username.trim().replace(/^@/, '').toLowerCase()] : [];
  }

  if (provider === 'tiktok') {
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: creds.clientId,
        client_secret: creds.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });
    if (!tokenRes.ok) return [];
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return [];
    const meRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=username,display_name',
      { headers: { Authorization: `Bearer ${tokenJson.access_token}` } },
    );
    if (!meRes.ok) return [];
    // `username` only; `display_name` is free text.
    const me = (await meRes.json()) as { data?: { user?: { username?: string } } };
    return verifiedUsernames([me.data?.user?.username]);
  }

  if (provider === 'ebay') {
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.EBAY_RU_NAME?.trim() || redirectUri,
      }),
    });
    if (!tokenRes.ok) return [];
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return [];
    const meRes = await fetch('https://apiz.ebay.com/commerce/identity/v1/user/', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!meRes.ok) return [];
    const me = (await meRes.json()) as { username?: string };
    return me.username ? [me.username.trim().replace(/^@/, '').toLowerCase()] : [];
  }

  // Facebook (and Instagram through Facebook Login): Facebook Login returns a display
  // NAME, never a username, and a name proves nothing about a handle (two people share
  // one; anyone can rename themselves). This used to compare the name with the handle
  // and approve on a match. It now verifies nothing, so the callback refuses.
  return [];
}

/** Lower-cased usernames the provider itself reported, blanks dropped. */
function verifiedUsernames(values: Array<string | undefined>): string[] {
  return values
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().replace(/^@/, '').toLowerCase());
}

/**
 * The `social_claims.platform` a provider's sign-in proves. One to one: an eBay sign-in
 * proves an eBay handle and nothing else. (eBay used to be filed as `instagram`, so an
 * eBay username claimed the Instagram handle of the same name.)
 */
function claimPlatformColumn(provider: ClaimOAuthProviderSlug): ClaimOAuthProviderSlug {
  return provider;
}

/** Redirect back with a reason the claim dialog can show. */
function claimFailed(url: URL, message: string): NextResponse {
  url.searchParams.set('claimError', message);
  return NextResponse.redirect(url);
}

/**
 * Whether this member may claim handles at all: the same rule as every other claim
 * path in `lib/actions/references.ts` (ID-verified, not banned, not closed).
 */
/** What `claimantProblem` returns for a member who has not passed the ID check yet. */
const IDENTITY_REQUIRED = 'IDENTITY_REQUIRED';

async function claimantProblem(userId: string): Promise<string | null> {
  const { data: profile } = await createAdminClient()
    .from('profiles')
    .select('identity_check_status, fraud_banned_at, closed_at')
    .eq('id', userId)
    .maybeSingle();
  if (!profile || profile.fraud_banned_at || profile.closed_at) {
    return "This account can't claim handles.";
  }
  // Not a message: the caller starts the check and sends the member back to the page.
  if (profile.identity_check_status !== 'VERIFIED') return IDENTITY_REQUIRED;
  return null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider: rawProvider } = await context.params;
  const provider: ClaimOAuthProviderSlug =
    rawProvider === 'discord' ||
    rawProvider === 'x' ||
    rawProvider === 'instagram' ||
    rawProvider === 'facebook' ||
    rawProvider === 'tiktok' ||
    rawProvider === 'ebay'
      ? rawProvider
      : 'discord';

  const origin = resolveOrigin(request);
  const params = request.nextUrl.searchParams;
  const code = params.get('code');
  const stateParam = params.get('state');
  const redirectUri = `${origin}/api/oauth/claim/${provider}`;

  // Step 2: Callback from the OAuth2 provider
  if (code || params.get('error')) {
    const cookieStore = await cookies();
    const rawCookie = cookieStore.get(COOKIE_NAME)?.value;
    cookieStore.delete(COOKIE_NAME);

    const payload = verifyState(rawCookie);
    const fallbackUrl = new URL(payload?.returnPath ?? '/references', origin);

    if (!payload || stateParam !== payload.nonce || params.get('error') || !code) {
      fallbackUrl.searchParams.set('claimError', 'OAuth verification was cancelled or expired.');
      return NextResponse.redirect(fallbackUrl);
    }

    // The state cookie must have been minted for THIS provider.
    if (payload.provider !== provider) {
      return claimFailed(fallbackUrl, 'OAuth verification was cancelled or expired.');
    }

    // The member finishing the flow must be the member who started it, still signed in.
    const supabase = await createClient();
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();
    if (!payload.userId || !sessionUser || sessionUser.id !== payload.userId) {
      const signInUrl = new URL('/sign-in', origin);
      signInUrl.searchParams.set('redirectTo', payload.returnPath);
      return NextResponse.redirect(signInUrl);
    }
    const problem = await claimantProblem(payload.userId);
    if (problem === IDENTITY_REQUIRED) {
      return NextResponse.redirect(new URL(identityStartHref(payload.returnPath), origin));
    }
    if (problem) return claimFailed(fallbackUrl, problem);

    const creds = directProviderCreds(provider);
    if (!creds) return claimFailed(fallbackUrl, 'OAuth provider is not configured.');

    // FAIL CLOSED. A claim is approved only on a username the provider itself returned.
    // This used to approve the requested handle whenever the provider returned NOTHING
    // (a failed token exchange, which anyone could cause by editing `code` in the return
    // URL), so any unclaimed handle could be taken without proving anything.
    const handles = await fetchVerifiedHandles(provider, code, redirectUri, payload.verifier, creds);
    if (handles.length === 0) {
      return claimFailed(fallbackUrl, 'Could not verify your handle from the provider.');
    }
    if (payload.handleNorm !== '*' && !handles.includes(payload.handleNorm)) {
      return claimFailed(
        fallbackUrl,
        `Connected @${handles[0]}, which doesn't match @${payload.handleNorm}.`,
      );
    }
    const effectiveHandle = payload.handleNorm === '*' ? handles[0] : payload.handleNorm;
    const platform = claimPlatformColumn(provider);

    const admin = createAdminClient();
    const now = new Date().toISOString();

    // Scoped to the PLATFORM as well as the handle: a Discord sign-in proves a Discord
    // handle, never the Instagram handle that happens to share its spelling.
    const { data: existing, error: existingError } = await admin
      .from('social_claims')
      .select('id, claimed_profile_id')
      .eq('platform', platform)
      .eq('handle_norm', effectiveHandle)
      .maybeSingle();
    if (existingError) {
      return claimFailed(fallbackUrl, 'Something went wrong saving your claim. Try again.');
    }
    if (existing?.claimed_profile_id) {
      return existing.claimed_profile_id === payload.userId
        ? NextResponse.redirect(fallbackUrl)
        : claimFailed(fallbackUrl, 'This handle has already been claimed.');
    }

    const { error: writeError } = existing
      ? await admin
          .from('social_claims')
          .update({
            claimed_profile_id: payload.userId,
            claim_method: 'OAUTH',
            claimed_at: now,
            updated_at: now,
          })
          .eq('id', existing.id)
          .is('claimed_profile_id', null)
      : await admin.from('social_claims').insert({
          platform,
          handle: effectiveHandle,
          claimed_profile_id: payload.userId,
          created_by: payload.userId,
          claim_method: 'OAUTH',
          claimed_at: now,
        });
    if (writeError) {
      return claimFailed(fallbackUrl, 'Something went wrong saving your claim. Try again.');
    }

    return NextResponse.redirect(fallbackUrl);
  }

  // Step 1: Start the OAuth2 redirect
  const rawHandleParam = (params.get('handle') ?? '').trim();
  const isWildcard = rawHandleParam === '*';
  const rawHandle = isWildcard ? '*' : normalizeHandle(rawHandleParam);
  // Same-site paths only: `//evil.example` and `/\evil.example` also start with "/",
  // and `new URL()` reads both as another host.
  const nextParam = params.get('next') ?? '';
  const returnPath =
    nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.startsWith('/\\')
      ? nextParam
      : '/references';
  if (!isWildcard && !isValidClaimHandle(provider, rawHandle)) {
    return NextResponse.redirect(new URL(returnPath, origin));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const resumeOAuthPath = `/api/oauth/claim/${provider}?${params.toString()}`;
    return NextResponse.redirect(
      new URL(`/sign-in?redirectTo=${encodeURIComponent(resumeOAuthPath)}`, origin),
    );
  }

  // Refuse up front a sign-in that can never verify a username, rather than sending the
  // member through Facebook's consent screen only to fail on the way back: Facebook
  // Login returns no username, and Instagram falls back to it without INSTAGRAM_CLIENT_ID.
  if (provider === 'facebook' || (provider === 'instagram' && !process.env.INSTAGRAM_CLIENT_ID?.trim())) {
    return claimFailed(
      new URL(returnPath, origin),
      'This platform can’t confirm a username. Use Manual to verify it instead.',
    );
  }

  const problem = await claimantProblem(user.id);
  // Not verified: start the ID check now and come back to this page, rather than
  // stopping at a message the member then has to act on.
  if (problem === IDENTITY_REQUIRED) {
    return NextResponse.redirect(new URL(identityStartHref(returnPath), origin));
  }
  if (problem) return claimFailed(new URL(returnPath, origin), problem);

  const creds = directProviderCreds(provider);
  if (!creds) {
    return claimFailed(
      new URL(returnPath, origin),
      'Signing in with this platform isn’t available yet. Try another way to verify.',
    );
  }

  const nonce = randomBytes(16).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const signed = signState({
    nonce,
    verifier,
    handleNorm: rawHandle.toLowerCase(),
    userId: user.id,
    provider,
    returnPath,
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, signed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https'),
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  const authorizeUrl = buildAuthorizeUrl(
    provider,
    creds.clientId,
    redirectUri,
    nonce,
    pkceChallenge(verifier),
  );
  return NextResponse.redirect(authorizeUrl);
}
