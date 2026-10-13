import { NextRequest, NextResponse } from 'next/server';
import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { acceptTradeTerms } from '@/lib/actions/tradeNegotiation';
export async function POST(request: NextRequest) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_BODY', message: 'Invalid JSON.' }, { status: 400 });
  }
  const tradeId = String(body.tradeId ?? '');
  const result = await acceptTradeTerms(tradeId, Number(body.termsVersion ?? 0));
  // ESC-05: this trader pays the cash leg, buyer-present (a bank check may follow).
  // Flutter has no Stripe SDK, so the app hands off to the trade room on the website.
  if (result.ok && result.nextAction?.kind === 'PAY_TRADE_CASH') {
    return NextResponse.json({
      ok: true,
      data: { handoff: 'WEB', path: `/trades/${encodeURIComponent(tradeId)}` },
    });
  }
  return NextResponse.json(result);
}
