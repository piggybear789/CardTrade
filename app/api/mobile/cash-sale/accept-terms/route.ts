import { NextRequest, NextResponse } from 'next/server';
import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { acceptCashSaleTerms } from '@/lib/actions/cashSale';

export async function POST(request: NextRequest) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_BODY', message: 'Invalid JSON.' }, { status: 400 });
  }
  const cashSaleId = String(body.cashSaleId ?? '');
  const result = await acceptCashSaleTerms(cashSaleId, Number(body.termsVersion ?? 0));
  // ESC-03: the card issuer asked for a 3-D Secure check. Flutter has no Stripe SDK,
  // so the app hands off to the sale room on the website, which runs the check and
  // can resume it from a fresh page load. The secret never goes to the app.
  if (result.ok && result.nextAction) {
    return NextResponse.json({
      ok: true,
      data: { handoff: 'WEB', path: `/sales/${encodeURIComponent(cashSaleId)}` },
    });
  }
  return NextResponse.json(result);
}
