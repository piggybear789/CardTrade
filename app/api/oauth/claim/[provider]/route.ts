import { createHash, createHmac, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isValidHandle, normalizeHandle } from '@/domain/social/socialLinks';

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
    const me = (await meRes.json()) as { username?: string; global_name?: string };
    return [me.username, me.global_name]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim().replace(/^@/, '').toLowerCase());
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
    const me = (await meRes.json()) as { data?: { username?: string; name?: string } };
    return [me.data?.username, me.data?.name]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim().replace(/^@/, '').toLowerCase());
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
    const me = (await meRes.json()) as {
      data?: { user?: { username?: string; display_name?: string } };
    };
    return [me.data?.user?.username, me.data?.user?.display_name]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim().replace(/^@/, '').toLowerCase());
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

  // Facebook Graph API
  const tokenUrl = new URL('https://graph.facebook.com/v20.0/oauth/access_token');
  tokenUrl.searchParams.set('client_id', creds.clientId);
  tokenUrl.searchParams.set('client_secret', creds.clientSecret);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);
  tokenUrl.searchParams.set('code', code);

  const tokenRes = await fetch(tokenUrl);
  if (!tokenRes.ok) return [];
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) return [];

  const meUrl = new URL('https://graph.facebook.com/me');
  meUrl.searchParams.set('fields', 'id,name');
  meUrl.searchParams.set('access_token', tokenJson.access_token);
  const meRes = await fetch(meUrl);
  if (!meRes.ok) return [];
  const me = (await meRes.json()) as { name?: string };
  return [me.name]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().replace(/^@/, '').toLowerCase());
}

function claimPlatformColumn(
  provider: ClaimOAuthProviderSlug,
): 'discord' | 'x' | 'instagram' | 'facebook' | 'tiktok' {
  if (provider === 'ebay') return 'instagram';
  return provider;
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

    const creds = directProviderCreds(provider);
    if (!creds) {
      fallbackUrl.searchParams.set('claimError', 'OAuth provider is not configured.');
      return NextResponse.redirect(fallbackUrl);
    }

    const handles = await fetchVerifiedHandles(provider, code, redirectUri, payload.verifier, creds);
    if (
      payload.handleNorm !== '*' &&
      handles.length > 0 &&
      !handles.includes(payload.handleNorm)
    ) {
      fallbackUrl.searchParams.set(
        'claimError',
        `Connected @${handles[0]}, which doesn't match @${payload.handleNorm}.`,
      );
      return NextResponse.redirect(fallbackUrl);
    }

    const effectiveHandle =
      payload.handleNorm === '*' ? (handles[0] ?? '') : payload.handleNorm;
    if (!effectiveHandle) {
      fallbackUrl.searchParams.set('claimError', 'Could not verify your handle from the provider.');
      return NextResponse.redirect(fallbackUrl);
    }

    if (!payload.userId) {
      const signInUrl = new URL('/sign-in', origin);
      signInUrl.searchParams.set('redirectTo', payload.returnPath);
      return NextResponse.redirect(signInUrl);
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { data: updated } = await admin
      .from('social_claims')
      .update({
        claimed_profile_id: payload.userId,
        claim_method: 'OAUTH',
        claimed_at: now,
        updated_at: now,
      })
      .eq('handle_norm', effectiveHandle)
      .is('claimed_profile_id', null)
      .select('id');

    if (!updated || updated.length === 0) {
      await admin
        .from('social_claims')
        .insert({
          platform: claimPlatformColumn(provider),
          handle: effectiveHandle,
          claimed_profile_id: payload.userId,
          created_by: payload.userId,
          claim_method: 'OAUTH',
          claimed_at: now,
        });
    }

    return NextResponse.redirect(fallbackUrl);
  }

  // Step 1: Start the OAuth2 redirect
  const rawHandleParam = (params.get('handle') ?? '').trim();
  const isWildcard = rawHandleParam === '*';
  const rawHandle = isWildcard ? '*' : normalizeHandle(rawHandleParam);
  const returnPath = params.get('next')?.startsWith('/') ? params.get('next')! : '/references';
  if (!isWildcard && !isValidHandle(rawHandle)) {
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

  const creds = directProviderCreds(provider);
  if (!creds) {
    const back = new URL(returnPath, origin);
    back.searchParams.set('claimError', 'missing-keys');
    return NextResponse.redirect(back);
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
