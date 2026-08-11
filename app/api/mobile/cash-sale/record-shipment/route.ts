import { NextRequest, NextResponse } from 'next/server';
import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { recordCashSaleShipment } from '@/lib/actions/cashSale';

export async function POST(request: NextRequest) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_BODY', message: 'Invalid JSON.' }, { status: 400 });
  }
  const result = await recordCashSaleShipment(
    String(body.cashSaleId ?? ''),
    String(body.carrier ?? ''),
    String(body.trackingNumber ?? ''),
  );
  return NextResponse.json(result);
}
