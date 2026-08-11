import { NextRequest, NextResponse } from 'next/server';
import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { updateTradeHandoverTerms } from '@/lib/actions/trades';

export async function POST(request: NextRequest) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_BODY', message: 'Invalid JSON.' }, { status: 400 });
  }
  const result = await updateTradeHandoverTerms(
    String(body.tradeId ?? ''),
    body.input as Parameters<typeof updateTradeHandoverTerms>[1],
  );
  return NextResponse.json(result);
}
