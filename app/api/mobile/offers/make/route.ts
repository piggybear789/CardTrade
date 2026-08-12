import { NextRequest, NextResponse } from 'next/server';
import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { makeOffer } from '@/lib/actions/offers';

export async function POST(request: NextRequest) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_BODY', message: 'Invalid JSON.' }, { status: 400 });
  }
  const result = await makeOffer(
    String(body.itemId ?? ''),
    Number(body.amountCents ?? 0),
    body.message != null ? String(body.message) : undefined,
    String(body.sellerIdentityVersion ?? ''),
    Boolean(body.buyerConfirmedSellerIdentity),
  );
  return NextResponse.json(result);
}
