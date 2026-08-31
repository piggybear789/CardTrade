// tests/component/unifiedOnboardingSurface.test.tsx
//
// The two-gate seller sequence, and specifically the RETURN from Stripe's hosted
// pages (unified-seller-onboarding, Req 2, 13.3).
//
// WHY THIS FILE EXISTS. The surface shipped reading only its own columns, which a
// webhook writes. A member returning from a hosted identity check arrives one or two
// seconds after submitting; Stripe reaches `verified` around seven seconds later. So
// the read on return always said PENDING, nothing ever read again, and the step sat
// there offering the same button forever. Worse, when Stripe DECLINED — "the document
// is invalid" — that sentence went into `webhook_logs` and the member was shown an
// unchanged button, so a refusal and an untouched step looked identical.
//
// The guarantees pinned down here are therefore all about what the surface asks and
// what it says:
//   * it asks the PROVIDER on mount, and the provider's answer beats the database;
//   * it keeps asking while Stripe is still deciding, so it does not lose the race;
//   * it stops asking, and says so, rather than spinning forever;
//   * a decline is shown IN STRIPE'S OWN WORDS, with a retry;
//   * a member who never started a check is not polled and not shown a problem;
//   * step two stays shut until step one passes;
//   * nothing keeps polling after the surface goes away.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const getIdentityCheckState = vi.fn();
const refreshIdentityCheck = vi.fn();
const beginIdentityCheck = vi.fn();

vi.mock('@/lib/actions/identity', () => ({
  getIdentityCheckState: (...args: unknown[]) => getIdentityCheckState(...args),
  refreshIdentityCheck: (...args: unknown[]) => refreshIdentityCheck(...args),
  beginIdentityCheck: (...args: unknown[]) => beginIdentityCheck(...args),
}));

const getMerchantState = vi.fn();
const refreshPayoutStatus = vi.fn();
const startIdentityVerification = vi.fn();

vi.mock('@/lib/actions/merchant', () => ({
  getMerchantState: (...args: unknown[]) => getMerchantState(...args),
  refreshPayoutStatus: (...args: unknown[]) => refreshPayoutStatus(...args),
  startIdentityVerification: (...args: unknown[]) => startIdentityVerification(...args),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { UnifiedOnboardingSurface } from '@/components/onboarding/UnifiedOnboardingSurface';

/** An `IdentityCheckState` result, PENDING unless a test says otherwise. */
function identity(over: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    data: {
      status: 'PENDING',
      verifiedName: null,
      verifiedAt: null,
      failureReason: null,
      ...over,
    },
  };
}

/** A `MerchantStateData` result, unstarted unless a test says otherwise. */
function merchant(over: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    data: {
      merchantStatus: 'NONE',
      merchantRef: null,
      settlementsEnabled: false,
      complianceStatus: null,
      legalEntityName: null,
      tradingName: null,
      registrationNumber: null,
      identityVerifiedAt: null,
      ...over,
    },
  };
}

/**
 * Render and let the mount reads settle.
 *
 * `completion={null}` throughout: the exit control belongs to the wizard, and a
 * "Start listing" button appearing once both gates pass would just be noise in these
 * assertions.
 */
async function mountSurface() {
  const view = render(<UnifiedOnboardingSurface completion={null} />);
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

/** Push the poll forward without waiting on the wall clock. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Longer than the whole poll budget (~40s), so the loop is guaranteed to be spent. */
const PAST_THE_POLL_BUDGET_MS = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  getIdentityCheckState.mockReset();
  refreshIdentityCheck.mockReset();
  beginIdentityCheck.mockReset();
  getMerchantState.mockReset();
  refreshPayoutStatus.mockReset();
  startIdentityVerification.mockReset();

  // The default world: our columns say nothing has passed, and nothing was started.
  getIdentityCheckState.mockResolvedValue(identity());
  getMerchantState.mockResolvedValue(merchant());
  refreshIdentityCheck.mockResolvedValue({
    ok: false as const,
    error: 'NO_CHECK',
    message: 'You have not started an identity check yet.',
  });
  refreshPayoutStatus.mockResolvedValue(merchant());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UnifiedOnboardingSurface — returning from Stripe', () => {
  it('believes the provider over our own columns', async () => {
    // THE BUG, in one test. The database still says PENDING because the webhook has
    // not landed — in local development it never will — and the member is standing in
    // front of a check Stripe has already passed.
    getIdentityCheckState.mockResolvedValue(identity({ status: 'PENDING' }));
    refreshIdentityCheck.mockResolvedValue(
      identity({ status: 'VERIFIED', verifiedName: 'Ada Lovelace' }),
    );

    await mountSurface();

    expect(screen.getByText('Verified as Ada Lovelace')).toBeInTheDocument();
    expect(refreshIdentityCheck).toHaveBeenCalled();
  });

  it('keeps asking while Stripe is still processing, and ticks when it lands', async () => {
    // Stripe takes about seven seconds to go processing -> verified. The member is
    // back here in one or two, so a single read on return loses this race every time.
    refreshIdentityCheck
      .mockResolvedValueOnce(identity({ status: 'PENDING' }))
      .mockResolvedValueOnce(identity({ status: 'PENDING' }))
      .mockResolvedValue(identity({ status: 'VERIFIED', verifiedName: 'Ada Lovelace' }));

    await mountSurface();

    // Nothing has passed yet, and the surface says it is waiting rather than
    // pretending the step is untouched.
    expect(screen.queryByText(/Verified as/)).not.toBeInTheDocument();
    expect(screen.getByText(/checking with stripe/i)).toBeInTheDocument();

    await advance(10_000);

    expect(screen.getByText('Verified as Ada Lovelace')).toBeInTheDocument();
    expect(refreshIdentityCheck.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('gives up after its budget and says the review is still running', async () => {
    // A manual review can take minutes. An endless spinner is a worse answer than
    // telling the member to come back, so the loop is bounded and terminates in words.
    refreshIdentityCheck.mockResolvedValue(identity({ status: 'PENDING' }));

    await mountSurface();
    await advance(PAST_THE_POLL_BUDGET_MS);

    expect(screen.getByText(/still reviewing your document/i)).toBeInTheDocument();
    expect(screen.queryByText(/checking with stripe/i)).not.toBeInTheDocument();
    // Bounded: the reads stop rather than running for as long as the tab is open.
    const settled = refreshIdentityCheck.mock.calls.length;
    await advance(PAST_THE_POLL_BUDGET_MS);
    expect(refreshIdentityCheck).toHaveBeenCalledTimes(settled);
  });
});

describe('UnifiedOnboardingSurface — a declined check', () => {
  it("shows Stripe's own reason, because it is the only one that says what to change", async () => {
    // This exact sentence was returned by Stripe, written to `webhook_logs`, and never
    // shown to anyone. "The document is invalid" tells a member to try another
    // document; an unchanged button tells them the site is broken.
    refreshIdentityCheck.mockResolvedValue(
      identity({ status: 'FAILED', failureReason: 'The document is invalid.' }),
    );

    await mountSurface();

    expect(screen.getByText('The document is invalid.')).toBeInTheDocument();
  });

  it('offers a retry rather than the same untouched call to action', async () => {
    refreshIdentityCheck.mockResolvedValue(
      identity({ status: 'FAILED', failureReason: 'The document is invalid.' }),
    );

    await mountSurface();

    expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /continue with stripe/i })).toBeNull();
  });

  it('falls back to its own words when the provider gives no reason', async () => {
    refreshIdentityCheck.mockResolvedValue(identity({ status: 'FAILED', failureReason: null }));

    await mountSurface();

    expect(screen.getByText(/could not verify that document/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('does not poll or accuse anyone when no check was ever started', async () => {
    // `NO_CHECK` is the resting state of a member who has just arrived. Treating it as
    // "still processing" would show a spinner over a step nobody has touched.
    await mountSurface();
    await advance(PAST_THE_POLL_BUDGET_MS);

    expect(refreshIdentityCheck).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/checking with stripe/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/still reviewing/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with stripe/i })).toBeInTheDocument();
  });
});

describe('UnifiedOnboardingSurface — the sequence', () => {
  it('keeps payouts shut until identity passes', async () => {
    // The gates are ordered, so exactly one control may be on screen. Two "Continue
    // with Stripe" buttons at once is the failure this surface was built to end.
    await mountSurface();

    expect(screen.getByText('Verify your identity')).toBeInTheDocument();
    expect(screen.getByText('Add payout details')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /continue with stripe/i })).toHaveLength(1);
  });

  it('hands over to payouts once identity passes', async () => {
    refreshIdentityCheck.mockResolvedValue(
      identity({ status: 'VERIFIED', verifiedName: 'Ada Lovelace' }),
    );

    await mountSurface();

    expect(screen.getByText('Verified as Ada Lovelace')).toBeInTheDocument();
    // Still exactly one control — it has moved down to step two.
    expect(screen.getAllByRole('button', { name: /continue with stripe/i })).toHaveLength(1);
  });

  it('reads payouts back from the provider too, not just from our columns', async () => {
    // Same trap as identity: `account.updated` may not have landed when the member
    // returns from Connect, so the column is stale and the read-back is the truth.
    getIdentityCheckState.mockResolvedValue(identity({ status: 'VERIFIED', verifiedName: 'Ada' }));
    refreshIdentityCheck.mockResolvedValue(identity({ status: 'VERIFIED', verifiedName: 'Ada' }));
    getMerchantState.mockResolvedValue(
      merchant({ merchantRef: 'acct_1', merchantStatus: 'PENDING', settlementsEnabled: false }),
    );
    refreshPayoutStatus.mockResolvedValue(
      merchant({ merchantRef: 'acct_1', merchantStatus: 'APPROVED', settlementsEnabled: true }),
    );

    await mountSurface();

    expect(refreshPayoutStatus).toHaveBeenCalled();
    expect(screen.getByText('Payouts active')).toBeInTheDocument();
  });

  it('reports both gates settled to its host, so the wizard can offer the way out', async () => {
    refreshIdentityCheck.mockResolvedValue(identity({ status: 'VERIFIED', verifiedName: 'Ada' }));
    getMerchantState.mockResolvedValue(
      merchant({ merchantRef: 'acct_1', merchantStatus: 'APPROVED', settlementsEnabled: true }),
    );

    const onSettledChange = vi.fn();
    render(<UnifiedOnboardingSurface completion={null} onSettledChange={onSettledChange} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(onSettledChange).toHaveBeenCalledWith(true);
  });
});

describe('UnifiedOnboardingSurface — lifecycle', () => {
  it('stops polling once it is gone', async () => {
    // The loop sleeps between reads, so without an ownership check an unmounted
    // surface carries on billing Stripe reads and writing into a dead tree. In
    // development StrictMode makes this worse: mount/unmount/mount would leave two
    // loops running side by side.
    refreshIdentityCheck.mockResolvedValue(identity({ status: 'PENDING' }));

    const { unmount } = await mountSurface();
    const callsWhileMounted = refreshIdentityCheck.mock.calls.length;

    unmount();
    await advance(PAST_THE_POLL_BUDGET_MS);

    expect(refreshIdentityCheck).toHaveBeenCalledTimes(callsWhileMounted);
  });

  it('paints a server-supplied snapshot without waiting for a round trip', async () => {
    // A caller that already knows the answer must not open on a skeleton and then
    // resolve to what it already knew.
    render(
      <UnifiedOnboardingSurface
        completion={null}
        initialStatus={{ identityDone: true, payoutDone: false, verifiedName: 'Ada Lovelace' }}
      />,
    );

    // Asserted BEFORE settling: this is the first paint, with no round trip resolved.
    expect(screen.getByText('Verified as Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /loading your setup/i })).toBeNull();

    // Then let the mount reads land, so their state updates belong to this test
    // rather than escaping into the next one.
    await advance(PAST_THE_POLL_BUDGET_MS);
  });
});
