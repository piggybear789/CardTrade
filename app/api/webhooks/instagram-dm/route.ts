import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

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

const CODE_REGEX = /\b(ND-[A-Z0-9]{6}|noditto-[a-z0-9]{6})\b/i;

function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = (
    process.env.INSTAGRAM_APP_SECRET ||
    process.env.INSTAGRAM_CLIENT_SECRET ||
    process.env.FACEBOOK_CLIENT_SECRET ||
    ''
  ).trim();
  if (!appSecret) return false;
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const actual = signatureHeader.slice('sha256='.length);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(actual, 'utf8'));
}

async function fetchSenderInstagramUsername(senderIgsid: string): Promise<string | null> {
  const token = (
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN ||
    process.env.INSTAGRAM_ACCESS_TOKEN ||
    ''
  ).trim();
  if (!token) return null;

  const url = new URL(`https://graph.instagram.com/v20.0/${encodeURIComponent(senderIgsid)}`);
  url.searchParams.set('fields', 'username');
  url.searchParams.set('access_token', token);

  const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json()) as { username?: string };
  return data.username ? data.username.trim().replace(/^@/, '').toLowerCase() : null;
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

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/** Incoming Instagram DM webhook events. */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const sig = request.headers.get('x-hub-signature-256');
  if (!verifyWebhookSignature(rawBody, sig)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: InstagramWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as InstagramWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (payload.object !== 'instagram') {
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

      const { data: claimReq } = await admin
        .from('handle_claim_requests')
        .select('id, claim_id, claimant_id, bio_code, status')
        .ilike('bio_code', code)
        .eq('status', 'PENDING')
        .maybeSingle();

      if (!claimReq) continue;

      const { data: socialClaim } = await admin
        .from('social_claims')
        .select('id, handle_norm, claimed_profile_id')
        .eq('id', claimReq.claim_id)
        .maybeSingle();

      if (!socialClaim || socialClaim.claimed_profile_id) continue;

      const senderUsername = await fetchSenderInstagramUsername(senderId);
      if (!senderUsername || senderUsername !== socialClaim.handle_norm) {
        continue;
      }

      const now = new Date().toISOString();
      await Promise.all([
        admin
          .from('handle_claim_requests')
          .update({
            status: 'APPROVED',
            staff_notes: `Verified automatically via Instagram DM bot (@${senderUsername})`,
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
    }
  }

  return NextResponse.json({ ok: true });
}
