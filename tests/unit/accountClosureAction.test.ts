// tests/unit/accountClosureAction.test.ts
//
// The WEB entry point onto the Account_Closure_Service (Req 7.1).
//
// What is worth testing about a thin action is exactly the two things that are not the
// orchestrator's job:
//
//   1. It takes the target from the SESSION and never from an argument. Every export of
//      a `'use server'` module is an endpoint anyone who learns its id can call, and the
//      repository behind this one uses the service-role client, so "caller and target
//      are the same id" is the whole authorisation story (Req 7.7).
//   2. An unauthenticated call refuses without reaching the orchestrator at all —
//      nothing service-role-backed runs for a caller with no session.
//
// The money rule, the blocker categories and the closure steps are covered where they
// live (`accountClosure.test.ts`, the closure property tests); they are not re-asserted
// here, because this module deliberately contains no copy of them.

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The user the mocked cookie-bound client reports, or null for no session. */
let sessionUser: { id: string } | null = null;

/** Calls the action made into the orchestrator. */
const closeAccountCalls: Array<{ callerProfileId: string; targetProfileId: string; at: Date }> = [];

/** What the mocked orchestrator returns. */
let closeAccountResult: unknown = { ok: true, data: { closedAt: '2026-01-01T00:00:00.000Z' } };

const signOutCalls: number[] = [];
const revalidated: string[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: sessionUser }, error: null }),
    },
  }),
}));

vi.mock('@/domain/orchestrator/supabaseAccountClosureRepository', () => ({
  createDefaultAccountClosureOrchestrator: () => ({
    closeAccount: async (params: { callerProfileId: string; targetProfileId: string; at: Date }) => {
      closeAccountCalls.push(params);
      return closeAccountResult;
    },
  }),
}));

vi.mock('@/lib/actions/auth', () => ({
  signOut: async () => {
    signOutCalls.push(1);
    return { ok: true, data: null };
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

const { closeMyAccount } = await import('@/lib/actions/account');

const MEMBER = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  sessionUser = { id: MEMBER };
  closeAccountCalls.length = 0;
  signOutCalls.length = 0;
  revalidated.length = 0;
  closeAccountResult = { ok: true, data: { closedAt: '2026-01-01T00:00:00.000Z' } };
});

describe('closeMyAccount', () => {
  it('closes the caller\'s own account, and passes the session id as both caller and target', async () => {
    const result = await closeMyAccount();

    expect(result.ok).toBe(true);
    expect(closeAccountCalls).toHaveLength(1);
    const call = closeAccountCalls[0];
    // The guard in `closeAccount` compares these two, so a web caller can only ever
    // close their own account (Req 7.7).
    expect(call.callerProfileId).toBe(MEMBER);
    expect(call.targetProfileId).toBe(MEMBER);
    // The closure instant is supplied by the caller; the orchestrator reads no clock.
    expect(call.at).toBeInstanceOf(Date);
  });

  it('signs the member out and revalidates the surfaces that showed their name', async () => {
    await closeMyAccount();

    // Req 7.2: on the web, being signed out means this request's cookie is cleared, and
    // that goes through the existing sign-out action.
    expect(signOutCalls).toHaveLength(1);
    expect(revalidated).toContain('/profile');
    expect(revalidated).toContain(`/sellers/${MEMBER}`);
  });

  it('refuses an unauthenticated caller without reaching the orchestrator', async () => {
    sessionUser = null;

    const result = await closeMyAccount();

    expect(result).toEqual({
      ok: false,
      error: 'NOT_ACCOUNT_OWNER',
      message: 'Sign in to close your account.',
    });
    // Nothing service-role-backed ran, and no cookie was cleared for a caller who held
    // no session in the first place.
    expect(closeAccountCalls).toHaveLength(0);
    expect(signOutCalls).toHaveLength(0);
  });

  it('returns a refusal verbatim, blockers included, and does not sign the member out', async () => {
    closeAccountResult = {
      ok: false,
      error: 'MONEY_IN_FLIGHT',
      message: 'Your account still has activity in progress, so it cannot be closed yet.',
      blockers: ['ACTIVE_CASH_SALE', 'OPEN_DISPUTE'],
    };

    const result = await closeMyAccount();

    // Req 7.3: the categories survive the action layer. Narrowing the return type to
    // `ActionResult` would have dropped them.
    expect(result).toEqual(closeAccountResult);
    expect(signOutCalls).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });
});
