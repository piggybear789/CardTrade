import { NextRequest, NextResponse } from 'next/server';
import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { recordShipment } from '@/lib/actions/trades';

export async function POST(request: NextRequest) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_BODY', message: 'Invalid JSON.' }, { status: 400 });
  }
  const result = await recordShipment(
    String(body.tradeId ?? ''),
    body.shipment ? body.shipment as Parameters<typeof recordShipment>[1] : undefined,
  );
  return NextResponse.json(result);
}
