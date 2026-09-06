// app/api/mobile/cash-sale/step-plan/route.ts
//
// The Cash_Sale contract step plan, served (`.kiro/specs/mobile-parity/` Req 11.1, 11.2).
//
// Thin by design: authenticate, read the id, delegate. The plan itself is derived by
// `deriveCashSaleSteps` in `domain/contract/`, the same module the web contract room
// reads, via the adapter in `lib/api/contractStepPlan.ts`. No step, ordering or halted
// rule is decided here, and none may be added — the point of serving the plan is that
// there is one definition of it.

import { NextRequest, NextResponse } from 'next/server';

import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { cashSaleStepPlan } from '@/lib/api/contractStepPlan';

/**
 * POST — the ordered step plan for one cash sale, as the calling participant sees it.
 *
 * POST rather than GET to match every other read on this surface (`list-items`,
 * `get-conversation`): the id travels in the body, so it never lands in a log line or a
 * shared URL.
 *
 * Refusals are 200 carrying `ok: false` — `NOT_FOUND`, `NOT_A_PARTICIPANT` or
 * `STATUS_NOT_RECOGNISED` — because each is a domain outcome rather than a transport
 * error, and the client's response to every one of them is the same neutral room
 * (Req 11.5). A caller with no session gets 401 from `authenticateMobileRequest`.
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

  const result = await cashSaleStepPlan(
    auth.session.supabase,
    auth.session.userId,
    String(body.cashSaleId ?? ''),
  );

  return NextResponse.json(result);
}
