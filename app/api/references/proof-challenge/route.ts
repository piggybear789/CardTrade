// app/api/references/proof-challenge/route.ts
//
// Creates a 1-click expiring Proof-of-Card Challenge link (`/references/verify/[token]`)
// that a buyer pastes into Messenger / Instagram DM to prove live physical possession.

import { NextResponse, type NextRequest } from 'next/server';

import { createProofChallenge } from '@/lib/enrichment/proofChallenge';
import { rateLimitIdentifier } from '@/lib/rateLimit';
import { referenceCheckLimiter } from '@/lib/rateLimiters';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

export async function POST(request: NextRequest) {
  const user = await getCachedAuthUser().catch(() => null);
  const identifier = await rateLimitIdentifier(user?.id ?? null);
  if (!(await referenceCheckLimiter.check(identifier)).allowed) {
    return NextResponse.json(
      { error: 'Too many proof challenges created. Wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        targetLabel?: string;
        targetKey?: string | null;
        itemDescription?: string;
        psaCertNumber?: string | null;
      }
    | null;

  const targetLabel = body?.targetLabel?.trim() ?? '';
  const itemDescription = body?.itemDescription?.trim() ?? '';
  if (!targetLabel || itemDescription.length < 2) {
    return NextResponse.json(
      { error: 'Enter the seller name/handle and the card or item to verify.' },
      { status: 400 },
    );
  }

  try {
    const challenge = await createProofChallenge({
      targetLabel,
      targetKey: body?.targetKey ?? null,
      itemDescription,
      psaCertNumber: body?.psaCertNumber ?? null,
      createdBy: user?.id ?? null,
    });
    return NextResponse.json(challenge, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/references/proof-challenge] POST failed:', error);
    return NextResponse.json(
      { error: 'Could not create proof challenge right now. Please try again.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
