// tests/component/payoutOnboarding.test.tsx
//
// Seller payout onboarding UI (Req 3.9, 4.8-4.12). The important guarantees are
// behavioural, not cosmetic:
//   * the disclosure consent is genuinely required before anything is submitted;
//   * an approved seller sees exactly the identity buyers see;
//   * the test-mode simulator only appears when the SERVER says it may.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const submitMerchantOnboarding = vi.fn();
const simulateMerchantCompliance = vi.fn();

vi.mock('@/lib/actions/merchant', () => ({
  submitMerchantOnboarding: (...args: unknown[]) => submitMerchantOnboarding(...args),
  simulateMerchantCompliance: (...args: unknown[]) => simulateMerchantCompliance(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { PayoutOnboarding } from '@/components/profile/PayoutOnboarding';
import type { PayoutSetupContext } from '@/lib/actions/merchant';

function context(overrides: Partial<PayoutSetupContext> = {}): PayoutSetupContext {
  return {
    state: {
      merchantStatus: 'NONE',
      merchantRef: null,
      settlementsEnabled: false,
    },
    canSimulateCompliance: false,
    providerIsPinch: true,
    ...overrides,
  };
}

/**
 * The onboarding form lives in a modal, so it has to be opened before any field
 * exists in the document.
 */
async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /verify my identity|fix and resubmit/i }));
  await screen.findByLabelText(/legal name or registered entity/i);
}

/**
 * Fill the required fields across the two steps, ending on the last one where
 * consent and submit live. Values from earlier steps must survive the walk —
 * that is the behaviour worth pinning, not the step chrome itself.
 */
async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/legal name or registered entity/i), 'Jane Collector');
  await user.type(screen.getByLabelText(/abn or acn/i), '12345678901');
  await user.type(screen.getByLabelText(/business email/i), 'jane@example.com');
  await user.click(screen.getByRole('button', { name: /^next$/i }));

  await user.type(screen.getByLabelText(/account name/i), 'Jane Collector');
  await user.type(screen.getByLabelText(/^bsb$/i), '012001');
  await user.type(screen.getByLabelText(/account number/i), '12345678');

  await screen.findByRole('button', { name: /submit for verification/i });
}

describe('PayoutOnboarding', () => {
  beforeEach(() => {
    submitMerchantOnboarding.mockReset();
    simulateMerchantCompliance.mockReset();
  });

  it('refuses to submit until the buyer disclosure is consented to', async () => {
    const user = userEvent.setup();
    render(<PayoutOnboarding context={context()} />);

    await openForm(user);
    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /submit for verification/i }));

    // No provider call, and the reason is surfaced to the seller.
    expect(submitMerchantOnboarding).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/buyers must be able to see/i);
  });

  it('submits with consent and passes the identity through', async () => {
    submitMerchantOnboarding.mockResolvedValue({
      ok: true,
      data: {
        merchantStatus: 'PENDING',
        merchantRef: 'mch_1',
        settlementsEnabled: false,
        legalEntityName: 'Jane Collector',
      },
    });
    const user = userEvent.setup();
    render(<PayoutOnboarding context={context()} />);

    await openForm(user);
    await fillRequiredFields(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /submit for verification/i }));

    expect(submitMerchantOnboarding).toHaveBeenCalledTimes(1);
    expect(submitMerchantOnboarding.mock.calls[0][0]).toMatchObject({
      legalEntityName: 'Jane Collector',
      businessRegistrationNumber: '12345678901',
      bankAccountBsb: '012001',
      buyerDisclosureConsent: true,
    });
    // The card moves to the awaiting-review state.
    expect(await screen.findByText(/checking your bank details/i)).toBeInTheDocument();
  });

  it('surfaces a field error returned by the server', async () => {
    submitMerchantOnboarding.mockResolvedValue({
      ok: false,
      error: 'validation-error',
      message: 'Enter a 9-digit ACN or 11-digit ABN.',
      field: 'businessRegistrationNumber',
    });
    const user = userEvent.setup();
    render(<PayoutOnboarding context={context()} />);

    await openForm(user);
    await fillRequiredFields(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /submit for verification/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/9-digit ACN or 11-digit ABN/i);
  });

  it('shows an approved seller the identity buyers see, and no form', () => {
    render(
      <PayoutOnboarding
        context={context({
          state: {
            merchantStatus: 'APPROVED',
            merchantRef: 'mch_1',
            settlementsEnabled: true,
            legalEntityName: 'Jane Collector Pty Ltd',
            tradingName: 'Jane Cards',
            registrationNumber: '12345678901',
            identityVerifiedAt: '2026-07-25T00:00:00.000Z',
          },
        })}
      />,
    );

    expect(screen.getByText(/what buyers see/i)).toBeInTheDocument();
    expect(screen.getByText('Jane Collector Pty Ltd')).toBeInTheDocument();
    expect(screen.getByText('Jane Cards')).toBeInTheDocument();
    // ABN rendered in readable groups without altering the stored digits.
    expect(screen.getByText('12 345 678 901')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /submit for verification/i }),
    ).not.toBeInTheDocument();
  });

  it('hides the test-mode simulator unless the server allows it', () => {
    render(<PayoutOnboarding context={context({ state: { merchantStatus: 'PENDING', merchantRef: 'mch_1', settlementsEnabled: false } })} />);
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it('delivers a simulated provider decision when allowed', async () => {
    simulateMerchantCompliance.mockResolvedValue({
      ok: true,
      data: {
        merchantStatus: 'APPROVED',
        merchantRef: 'mch_1',
        settlementsEnabled: true,
        legalEntityName: 'Jane Collector Pty Ltd',
        registrationNumber: '12345678901',
      },
    });
    const user = userEvent.setup();
    render(
      <PayoutOnboarding
        context={context({
          state: { merchantStatus: 'PENDING', merchantRef: 'mch_1', settlementsEnabled: false },
          canSimulateCompliance: true,
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(simulateMerchantCompliance).toHaveBeenCalledWith('approved');
    expect(await screen.findByText(/what buyers see/i)).toBeInTheDocument();
  });
});
