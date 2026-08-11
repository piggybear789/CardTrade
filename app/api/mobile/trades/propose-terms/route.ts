import { NextRequest, NextResponse } from 'next/server';
import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { proposeTradeTerms } from '@/lib/actions/tradeNegotiation';

export async function POST(request: NextRequest) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_BODY', message: 'Invalid JSON.' }, { status: 400 });
  }
  const result = await proposeTradeTerms(
    String(body.tradeId ?? ''),
    Number(body.expectedTermsVersion ?? 0),
    body.terms as Parameters<typeof proposeTradeTerms>[2],
  );
  return NextResponse.json(result);
}
