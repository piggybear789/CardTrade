// tests/component/payoutOnboarding.test.tsx
//
// Seller payout onboarding (Req 3.9, 4.8-4.12).
//
// The guarantees worth pinning down after moving to provider-hosted onboarding:
//   * asking to verify leaves for the provider in ONE action — there is no
//     intermediate "save setup details" screen to click through (the shop-name
//     step that used to sit there was display-only data in the verification path);
//   * no bank, registration, date-of-birth or address field is collected here at
//     all — the provider owns those, so they must not exist in our DOM;
//   * returning from the provider does NOT display "verified" on its own; the
//     authoritative status is re-read;
//   * an account shell with transfers inactive never reads as verified;
//   * the payable view shows the provider-VERIFIED legal name and nothing private.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const startIdentityVerification = vi.fn();
const createPayoutOnboardingLink = vi.fn();
const refreshPayoutStatus = vi.fn();

vi.mock('@/lib/actions/merchant', () => ({
  startIdentityVerification: (...args: unknown[]) => startIdentityVerification(...args),
  createPayoutOnboardingLink: (...args: unknown[]) => createPayoutOnboardingLink(...args),
  refreshPayoutStatus: (...args: unknown[]) => refreshPayoutStatus(...args),
}));

const refresh = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  useSearchParams: () => searchParams,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PayoutOnboarding } from '@/components/profile/PayoutOnboarding';
import type { PayoutSetupContext } from '@/lib/actions/merchant';

function makeContext(overrides: Partial<PayoutSetupContext['state']> = {}): PayoutSetupContext {
  return {
    hostedOnboarding: true,
    state: {
      merchantStatus: 'NONE',
      merchantRef: null,
      settlementsEnabled: false,
      complianceStatus: null,
      legalEntityName: null,
      tradingName: null,
      registrationNumber: null,
      identityVerifiedAt: null,
      ...overrides,
    },
  };
}

/** window.location.assign is how the component leaves for the provider. */
const assign = vi.fn();

beforeEach(() => {
  startIdentityVerification.mockReset();
  createPayoutOnboardingLink.mockReset();
  refreshPayoutStatus.mockReset();
  refresh.mockReset();
  assign.mockReset();
  searchParams = new URLSearchParams();

  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign, href: 'http://localhost/profile' },
  });

  startIdentityVerification.mockResolvedValue({
    ok: true,
    data: { url: 'https://connect.stripe.com/setup/s/abc123' },
  });
  createPayoutOnboardingLink.mockResolvedValue({
    ok: true,
    data: { url: 'https://connect.stripe.com/setup/s/abc123' },
  });
});

describe('PayoutOnboarding', () => {
  it('leaves for the provider in one action, with no intermediate save step', async () => {
    const user = userEvent.setup();
    render(<PayoutOnboarding context={makeContext()} />);

    // The step that used to stand here.
    expect(screen.queryByLabelText(/store name/i)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /save setup details/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /verify with stripe/i }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://connect.stripe.com/setup/s/abc123'),
    );
    expect(startIdentityVerification).toHaveBeenCalledTimes(1);
  });

  it('states the buyer disclosure next to the control that consents to it', () => {
    render(<PayoutOnboarding context={makeContext()} />);

    expect(screen.getByText(/payout name Stripe reports can be shown/i)).toBeInTheDocument();
  });

  it('collects no bank, registration, date-of-birth or address fields', () => {
    render(<PayoutOnboarding context={makeContext()} />);

    // The provider owns all of these now; if any reappear here, sensitive data
    // has started flowing through our server again.
    for (const label of [/bsb/i, /account number/i, /abn|acn|registration/i, /date of birth/i, /address/i, /postcode/i]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
  });

  it('surfaces a server error without redirecting', async () => {
    startIdentityVerification.mockResolvedValue({
      ok: false,
      error: 'submission-failed',
      message: 'Payout setup could not be submitted. Please try again.',
    });

    const user = userEvent.setup();
    render(<PayoutOnboarding context={makeContext()} />);
    await user.click(screen.getByRole('button', { name: /verify with stripe/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be submitted/i);
    expect(assign).not.toHaveBeenCalled();
  });

  it('never reads as verified while the provider has not enabled transfers', () => {
    render(
      <PayoutOnboarding
        context={makeContext({
          merchantStatus: 'APPROVED',
          merchantRef: 'acct_1',
          settlementsEnabled: false,
          identityVerifiedAt: '2026-08-01T00:00:00.000Z',
        })}
      />,
    );

    // An empty Connect shell is an unfinished setup, not a verified account. This
    // card used to badge it "Verified Through Stripe" the moment the shell existed.
    expect(screen.queryByText(/verified/i)).toBeNull();
    expect(screen.getByText(/setup incomplete/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with stripe/i })).toBeInTheDocument();
  });

  it('re-reads status on return from the provider rather than assuming success', async () => {
    searchParams = new URLSearchParams('payouts=complete');
    refreshPayoutStatus.mockResolvedValue({
      ok: true,
      data: { ...makeContext().state, merchantStatus: 'PENDING', merchantRef: 'acct_1' },
    });

    render(<PayoutOnboarding context={makeContext({ merchantStatus: 'PENDING', merchantRef: 'acct_1' })} />);

    await waitFor(() => expect(refreshPayoutStatus).toHaveBeenCalledTimes(1));
    // Payout setup is still in progress, so the card must not claim the seller can be paid.
    expect(screen.getByText(/setup incomplete/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Payout account name$/i)).toBeNull();
  });

  it('explains an expired setup link and offers to restart it', async () => {
    searchParams = new URLSearchParams('payouts=refresh');
    refreshPayoutStatus.mockResolvedValue({
      ok: true,
      data: { ...makeContext().state, merchantStatus: 'PENDING', merchantRef: 'acct_1' },
    });

    render(<PayoutOnboarding context={makeContext({ merchantStatus: 'PENDING', merchantRef: 'acct_1' })} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/i);
    expect(screen.getByRole('button', { name: /continue with stripe/i })).toBeInTheDocument();
  });

  it('shows the provider-verified name once approved, and nothing private', () => {
    render(
      <PayoutOnboarding
        context={makeContext({
          merchantStatus: 'APPROVED',
          merchantRef: 'acct_1',
          settlementsEnabled: true,
          legalEntityName: 'Jane Collector',
          tradingName: 'Harbour City Cards',
          identityVerifiedAt: '2026-08-01T00:00:00.000Z',
        })}
      />,
    );

    expect(screen.getByText('Jane Collector')).toBeInTheDocument();
    expect(screen.getByText('Harbour City Cards')).toBeInTheDocument();
    // The merchant reference is a provider credential, never surfaced.
    expect(screen.queryByText(/acct_1/)).toBeNull();
  });

  it('renders a compact merchant identity summary on the payouts dashboard', () => {
    render(
      <PayoutOnboarding
        compact
        context={makeContext({
          merchantStatus: 'APPROVED',
          merchantRef: 'acct_1',
          settlementsEnabled: true,
          legalEntityName: 'Jane Collector',
          tradingName: 'Harbour City Cards',
          identityVerifiedAt: '2026-08-01T00:00:00.000Z',
        })}
      />,
    );

    expect(screen.getByText('Merchant identity')).toBeInTheDocument();
    expect(screen.getByText('Verified Account')).toBeInTheDocument();
    expect(screen.getByText('Jane Collector')).toBeInTheDocument();
    expect(screen.queryByText(/this is what buyers may see/i)).toBeNull();
    expect(screen.getByRole('button', { name: /manage with stripe/i })).toBeInTheDocument();
  });
});
