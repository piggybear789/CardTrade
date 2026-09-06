// tests/unit/accountClosureEndpoint.test.ts
//
// The MOBILE entry point onto the Account_Closure_Service (Req 7.1, 7.10).
//
// The companion to `accountClosureAction.test.ts`, asserting the same two things about
// the handler that the action test asserts about the web door, because they are the only
// two things a thin handler can get wrong:
//
//   1. The target comes from the SESSION. The repository behind the orchestrator uses
//      the service-role client, so "caller and target are the same id" is the whole
//      authorisation story (Req 7.7) — a body-supplied id must not reach it. The
//      assertion is on the id the orchestrator RECEIVED, not merely on the status, so a
//      handler that forwarded another member's id and happened to be refused deeper down
//      would still fail here.
//   2. An unauthenticated call refuses without reaching the orchestrator at all.
//
// Plus the one shape guarantee the mobile client depends on: a `MONEY_IN_FLIGHT` refusal
// carries its `blockers` through the transport (Req 7.3).
//
// The money rule, the blocker categories and the closure steps are covered where they
// live; nothing is re-asserted here, because this handler contains no copy of them.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/** The user the mocked session helper reports, or null for no session. */
let sessionUser: { id: string } | null = null;

/** Calls the handler made into the orchestrator. */
const closeAccountCalls: Array<{
  callerProfileId: string;
  targetProfileId: string;
  at: Date;
}> = [];

/** What the mocked orchestrator returns. */
let closeAccountResult: unknown = { ok: true, data: { closedAt: '2026-01-01T00:00:00.000Z' } };

vi.mock('@/lib/api/mobileSession', () => ({
  authenticateMobileRequest: async () =>
    sessionUser
      ? { ok: true, session: { userId: sessionUser.id, supabase: {} } }
      : {
          ok: false,
          response: new Response(
            JSON.stringify({
              ok: false,
              error: 'NOT_AUTHENTICATED',
              message: 'Please sign in to continue.',
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          ),
        },
}));

vi.mock('@/domain/orchestrator/supabaseAccountClosureRepository', () => ({
  createDefaultAccountClosureOrchestrator: () => ({
    closeAccount: async (params: {
      callerProfileId: string;
      targetProfileId: string;
      at: Date;
    }) => {
      closeAccountCalls.push(params);
      return closeAccountResult;
    },
  }),
}));

const { POST } = await import('@/app/api/mobile/account/close/route');

const MEMBER = '11111111-1111-4111-8111-111111111111';
const OTHER_MEMBER = '22222222-2222-4222-8222-222222222222';

/**
 * A POST request with the given JSON body. The handler is not supposed to read the body
 * at all, so the body here exists only to prove that it does not.
 */
function post(body?: unknown): NextRequest {
  return new Request('https://noditto.app/api/mobile/account/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  sessionUser = { id: MEMBER };
  closeAccountCalls.length = 0;
  closeAccountResult = { ok: true, data: { closedAt: '2026-01-01T00:00:00.000Z' } };
});

describe('POST /api/mobile/account/close', () => {
  it('closes the authenticated member\'s own account, passing the session id as both caller and target', async () => {
    const response = await POST(post());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { closedAt: '2026-01-01T00:00:00.000Z' },
    });

    expect(closeAccountCalls).toHaveLength(1);
    const call = closeAccountCalls[0];
    expect(call.callerProfileId).toBe(MEMBER);
    expect(call.targetProfileId).toBe(MEMBER);
    // The orchestrator reads no clock; the instant is supplied by the caller.
    expect(call.at).toBeInstanceOf(Date);
  });

  it('refuses an unauthenticated call without reaching the orchestrator', async () => {
    sessionUser = null;

    const response = await POST(post());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'NOT_AUTHENTICATED',
      message: 'Please sign in to continue.',
    });
    // Nothing service-role-backed ran for a caller with no session.
    expect(closeAccountCalls).toHaveLength(0);
  });

  it('ignores a profile id named in the request body and closes the session member instead', async () => {
    const response = await POST(
      post({ profileId: OTHER_MEMBER, targetProfileId: OTHER_MEMBER, userId: OTHER_MEMBER }),
    );

    expect(response.status).toBe(200);
    expect(closeAccountCalls).toHaveLength(1);
    // Req 7.7: the id the orchestrator RECEIVED is the session member's, so the other
    // account was never a candidate for closure — not refused deeper down, never sent.
    expect(closeAccountCalls[0].callerProfileId).toBe(MEMBER);
    expect(closeAccountCalls[0].targetProfileId).toBe(MEMBER);
    expect(JSON.stringify(closeAccountCalls[0])).not.toContain(OTHER_MEMBER);
  });

  it('returns a blocked closure with its categories intact', async () => {
    closeAccountResult = {
      ok: false,
      error: 'MONEY_IN_FLIGHT',
      message: 'Your account still has activity in progress, so it cannot be closed yet.',
      blockers: ['ACTIVE_CASH_SALE', 'OPEN_DISPUTE'],
    };

    const response = await POST(post());

    // Req 7.3: an expected refusal is a 200 carrying `ok: false`, and the blocking
    // categories survive the transport so the Flutter client can render them as
    // sentences.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(closeAccountResult);
  });
});
