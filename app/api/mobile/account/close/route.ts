// app/api/mobile/account/close/route.ts
//
// Account_Closure_Service, MOBILE entry point (Req 7.1, 7.10).
//
// One capability, two doors. `closeAccount` in
// `domain/orchestrator/accountClosureOrchestrator.ts` is the service; `closeMyAccount`
// in `lib/actions/account.ts` is the web door and this handler is the mobile one. It
// deliberately delegates to the same orchestrator rather than to the web action, because
// the action also clears the browser's session cookie and revalidates web routes —
// neither of which means anything to a bearer-authenticated client. What it does NOT do
// is re-derive anything: no eligibility check, no Money_In_Flight rule, no write of its
// own, no `.rpc()` call and no direct table write (Req 7.10).
//
// THE TARGET COMES FROM THE SESSION AND NOWHERE ELSE. No profile id is read from the
// request body, and the body is not read at all. The repository behind the orchestrator
// uses the service-role client, so "the caller and the target are the same id" is the
// entire authorisation story (Req 7.7) — accepting a target from the request would hand
// an attacker a service-role-backed write. The session id is passed as BOTH
// `callerProfileId` and `targetProfileId`, which makes the orchestrator's own-account
// guard hold structurally rather than by trusting this handler to have checked.

import { NextRequest, NextResponse } from 'next/server';

import { authenticateMobileRequest } from '@/lib/api/mobileSession';
import { createDefaultAccountClosureOrchestrator } from '@/domain/orchestrator/supabaseAccountClosureRepository';

/**
 * POST — close the authenticated member's own account.
 *
 * Returns the orchestrator's `CloseAccountResult` verbatim, which is the same
 * `{ ok: true, data }` / `{ ok: false, error, message }` shape every other mobile
 * endpoint returns, plus `blockers` on a `MONEY_IN_FLIGHT` refusal (Req 7.3) so the
 * Flutter client can render the categories as sentences. Narrowing or reshaping the
 * result here would drop them.
 *
 * Status codes match the neighbours: 401 from `authenticateMobileRequest` for a caller
 * with no session, and 200 carrying an `ok: false` body for an expected refusal — the
 * refusal is a domain outcome, not a transport error.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) return auth.response;

  const orchestrator = createDefaultAccountClosureOrchestrator();
  const result = await orchestrator.closeAccount({
    callerProfileId: auth.session.userId,
    targetProfileId: auth.session.userId,
    at: new Date(),
  });

  return NextResponse.json(result);
}
