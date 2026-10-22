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
  // 0159: the buyer's card was issued outside the seller's card zone, so it costs more
  // than the stored total the app shows, and the app sends no expected total to price it
  // against. Nothing was charged. It stays a refusal (the app reports failures by their
  // message), pointed at the sale room, which prices the buyer's own card before Pay.
  if (!result.ok && result.error === 'card-repriced') {
    return NextResponse.json({
      ...result,
      message: `${result.message ?? 'Your card has a different service fee.'} The sale room on the website shows the total for your card.`,
      handoff: { kind: 'WEB', path: `/sales/${encodeURIComponent(cashSaleId)}` },
    });
  }
  return NextResponse.json(result);
}
