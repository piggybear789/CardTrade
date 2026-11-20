// app/api/references/proof-challenge/[token]/route.ts
//
// GET:  Reads challenge state and signed photo URL for holders of the unguessable token.
// POST: Submits the seller's live Proof-of-Card photo.

import { NextResponse, type NextRequest } from 'next/server';

import { getProofChallenge, submitProofChallengePhoto } from '@/lib/enrichment/proofChallenge';
import { rateLimitIdentifier } from '@/lib/rateLimit';
import { referenceCheckLimiter, referenceCheckPollLimiter } from '@/lib/rateLimiters';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']);

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const identifier = await rateLimitIdentifier(null);
  if (!(await referenceCheckPollLimiter.check(identifier)).allowed) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }

  const { token } = await context.params;
  const challenge = await getProofChallenge(token).catch(() => undefined);
  if (challenge === undefined) {
    return NextResponse.json({ error: 'Could not load challenge.' }, { status: 503 });
  }
  if (!challenge) {
    return NextResponse.json({ error: 'Proof challenge not found.' }, { status: 404 });
  }

  return NextResponse.json(challenge, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const identifier = await rateLimitIdentifier(null);
  if (!(await referenceCheckLimiter.check(identifier)).allowed) {
    return NextResponse.json({ error: 'Too many attempts. Wait a moment.' }, { status: 429 });
  }

  const { token } = await context.params;
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Take or attach a clear photo of the card and handwritten code.' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type.toLowerCase())) {
    return NextResponse.json({ error: 'Only JPG, PNG, WebP, or HEIC photos are supported.' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Photo must be under 10 MB.' }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await submitProofChallengePhoto(token, bytes);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  return NextResponse.json(result.challenge, { headers: { 'Cache-Control': 'no-store' } });
}
