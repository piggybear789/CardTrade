import { NextRequest, NextResponse } from 'next/server';
import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { initiateCashSale } from '@/lib/actions/cashSale';

export async function POST(request: NextRequest) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_BODY', message: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const result = await initiateCashSale({
    itemId: String(body.itemId ?? ''),
    sellerIdentityVersion: String(body.sellerIdentityVersion ?? ''),
    buyerConfirmedSellerIdentity: Boolean(body.buyerConfirmedSellerIdentity),
    agreedPriceCents: body.agreedPriceCents != null ? Number(body.agreedPriceCents) : undefined,
    lineItems: Array.isArray(body.lineItems) ? body.lineItems : undefined,
  });
  return NextResponse.json(result);
}
