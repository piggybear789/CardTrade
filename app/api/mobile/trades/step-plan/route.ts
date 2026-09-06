// app/api/mobile/trades/step-plan/route.ts
//
// The Trade contract step plan, served (`.kiro/specs/mobile-parity/` Req 11.1, 11.2).
//
// Separate from the cash-sale handler on purpose. A Trade and a Cash_Sale are different
// state machines with different fact interfaces, different tables and different id
// columns; a single endpoint would have to branch on a kind discriminator before it
// could read anything, which is a decision the transport layer must not hold. See the
// header of `lib/api/contractStepPlan.ts`.

import { NextRequest, NextResponse } from 'next/server';

import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { tradeStepPlan } from '@/lib/api/contractStepPlan';

/**
 * POST — the ordered step plan for one trade, as the calling trader sees it.
 *
 * Symmetric with the cash-sale handler: POST with the id in the body, 401 for no
 * session, and 200 with `ok: false` for a refusal the client answers with the neutral
 * room (Req 11.5).
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'INVALID_BODY', message: 'Invalid JSON.' },
      { status: 400 },
    );
  }

  const result = await tradeStepPlan(
    auth.session.supabase,
    auth.session.userId,
    String(body.tradeId ?? ''),
  );

  return NextResponse.json(result);
}
