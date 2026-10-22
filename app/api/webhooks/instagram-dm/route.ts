import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { getInstagramBotToken } from '@/lib/instagram/botToken';
import { createAdminClient } from '@/lib/supabase/admin';

// app/api/webhooks/instagram-dm/route.ts
//
// Meta Instagram Messaging API webhook for the Instagram DM claim bot.
// Works with ALL Instagram accounts (personal, creator, and business):
// 1. User copies their `ND-XXXXXX` code from the Claim modal on NoDitto.
// 2. User sends that code via Instagram DM to NoDitto's Instagram account.
// 3. Meta posts the `messages` webhook event here; we verify the sender's
//    Instagram `@username` matches the handle being claimed and approve the
//    claim automatically.
//
// EVERY WAY THIS CAN FAIL IS LOGGED (`webhook.instagram_dm.*`, see /admin?tab=errors).
// It used to fail silently at every step — a missing secret, a bad signature, a token
// that could not read the sender, a sender who was not the claimed handle — so a claim
// sat PENDING forever with nothing saying which step had stopped it. Context is ids
// only; Meta's own error text is kept because it names the misconfiguration.

const CODE_REGEX = /\b(ND-[A-Z0-9]{6}|noditto-[a-z0-9]{6})\b/i;

function appSecret(): string {
  return (
    process.env.INSTAGRAM_APP_SECRET ||
    process.env.INSTAGRAM_CLIENT_SECRET ||
    process.env.FACEBOOK_CLIENT_SECRET ||
    ''
  ).trim();
}

function verifyWebhookSignature(secret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const actual = signatureHeader.slice('sha256='.length);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(actual, 'utf8'));
}

type SenderLookup =
  | { ok: true; username: string }
  | { ok: false; errorCode: string; message: string };

async function fetchSenderInstagramUsername(senderIgsid: string): Promise<SenderLookup> {
  // The refreshed token (0160) while it descends from the env token, else the env token.
  const token = await getInstagramBotToken();
  if (!token) {
    return {
      ok: false,
      errorCode: 'NO_ACCESS_TOKEN',
      message: 'INSTAGRAM_PAGE_ACCESS_TOKEN (or INSTAGRAM_ACCESS_TOKEN) is not set',
    };
  }

  const url = new URL(`https://graph.instagram.com/v20.0/${encodeURIComponent(senderIgsid)}`);
  url.searchParams.set('fields', 'username');
  url.searchParams.set('access_token', token);

  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err: unknown) {
    return { ok: false, errorCode: 'GRAPH_UNREACHABLE', message: err instanceof Error ? err.message : String(err) };
  }
  const data = (await res.json().catch(() => ({}))) as {
    username?: string;
    error?: { message?: string; code?: number; type?: string };
  };
  if (!res.ok || !data.username) {
    return {
      ok: false,
      errorCode: `GRAPH_${res.status}`,
      message: data.error?.message ?? `Sender lookup returned ${res.status} with no username`,
    };
  }
  return { ok: true, username: data.username.trim().replace(/^@/, '').toLowerCase() };
}

interface InstagramWebhookPayload {
  object?: string;
  entry?: Array<{
    messaging?: Array<{
      sender?: { id?: string };
      message?: { text?: string; is_echo?: boolean };
    }>;
  }>;
}

/** Meta Webhook Verification handshake (`hub.mode=subscribe`). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  const expectedToken = (
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ||
    process.env.INSTAGRAM_CLIENT_SECRET ||
    ''
  ).trim();

  if (mode === 'subscribe' && challenge && expectedToken && token === expectedToken) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  if (mode === 'subscribe') {
    await logBackgroundFailure({
      name: 'webhook.instagram_dm.verify',
      errorCode: expectedToken ? 'VERIFY_TOKEN_MISMATCH' : 'NO_VERIFY_TOKEN',
      message: expectedToken
        ? 'Meta sent a verify token that does not match INSTAGRAM_WEBHOOK_VERIFY_TOKEN'
        : 'INSTAGRAM_WEBHOOK_VERIFY_TOKEN is not set',
    });
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/** Incoming Instagram DM webhook events. */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = appSecret();
  if (!secret) {
    await logBackgroundFailure({
      name: 'webhook.instagram_dm.signature',
      errorCode: 'NO_APP_SECRET',
      message: 'INSTAGRAM_APP_SECRET (or INSTAGRAM_CLIENT_SECRET / FACEBOOK_CLIENT_SECRET) is not set',
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  if (!verifyWebhookSignature(secret, rawBody, request.headers.get('x-hub-signature-256'))) {
    await logBackgroundFailure({
      name: 'webhook.instagram_dm.signature',
      errorCode: 'BAD_SIGNATURE',
      message: 'x-hub-signature-256 did not verify: the app secret is not the one for the app sending this webhook',
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: InstagramWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as InstagramWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (payload.object !== 'instagram') {
    await logBackgroundFailure({
      name: 'webhook.instagram_dm.payload',
      errorCode: 'UNEXPECTED_OBJECT',
      message: `Webhook object was "${String(payload.object)}", expected "instagram"`,
    });
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();

  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (event.message?.is_echo) continue;
      const text = event.message?.text ?? '';
      const senderId = event.sender?.id;
      const match = text.match(CODE_REGEX);
      if (!match || !senderId) continue;

      const code = match[1].toUpperCase();

      // `.limit(2)` rather than `.maybeSingle()`: two people claiming one handle get the
      // same code, and maybeSingle returns an ERROR (not a row) for two rows, which read
      // as "no request" and dropped the DM.
      const { data: requests, error: lookupError } = await admin
        .from('handle_claim_requests')
        .select('id, claim_id, claimant_id, bio_code, status')
        .ilike('bio_code', code)
        .eq('status', 'PENDING')
        .limit(2);

      if (lookupError) {
        await logBackgroundFailure({
          name: 'webhook.instagram_dm.lookup',
          errorCode: lookupError.code || 'LOOKUP_FAILED',
          message: lookupError.message,
        });
        continue;
      }
      if (!requests || requests.length === 0) {
        await logBackgroundFailure({
          name: 'webhook.instagram_dm.lookup',
          errorCode: 'NO_PENDING_REQUEST',
          message: 'A DM carried a claim code that matches no PENDING claim request',
        });
        continue;
      }
      if (requests.length > 1) {
        await logBackgroundFailure({
          name: 'webhook.instagram_dm.lookup',
          errorCode: 'AMBIGUOUS_CODE',
          message: 'More than one PENDING claim request shares this code; not approving either',
          context: { claimRequestId: requests[0].id },
        });
        continue;
      }
      const claimReq = requests[0];

      const { data: socialClaim } = await admin
        .from('social_claims')
        .select('id, handle_norm, claimed_profile_id')
        .eq('id', claimReq.claim_id)
        .maybeSingle();

      if (!socialClaim || socialClaim.claimed_profile_id) continue;

      const sender = await fetchSenderInstagramUsername(senderId);
      if (!sender.ok) {
        await logBackgroundFailure({
          name: 'webhook.instagram_dm.sender',
          errorCode: sender.errorCode,
          message: sender.message,
          context: { claimRequestId: claimReq.id },
        });
        continue;
      }
      if (sender.username !== socialClaim.handle_norm) {
        await logBackgroundFailure({
          name: 'webhook.instagram_dm.sender',
          errorCode: 'SENDER_MISMATCH',
          message: 'The DM came from a different Instagram account than the handle being claimed',
          context: { claimRequestId: claimReq.id },
        });
        continue;
      }

      const now = new Date().toISOString();
      const [requestUpdate, claimUpdate] = await Promise.all([
        admin
          .from('handle_claim_requests')
          .update({
            status: 'APPROVED',
            staff_notes: `Verified automatically via Instagram DM bot (@${sender.username})`,
            decided_at: now,
            updated_at: now,
          })
          .eq('id', claimReq.id),
        admin
          .from('social_claims')
          .update({
            claimed_profile_id: claimReq.claimant_id,
            claim_method: 'DM_BOT',
            claimed_at: now,
            updated_at: now,
          })
          .eq('id', socialClaim.id)
          .is('claimed_profile_id', null),
      ]);
      const writeError = requestUpdate.error ?? claimUpdate.error;
      if (writeError) {
        await logBackgroundFailure({
          name: 'webhook.instagram_dm.approve',
          errorCode: writeError.code || 'UPDATE_FAILED',
          message: writeError.message,
          context: { claimRequestId: claimReq.id },
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
