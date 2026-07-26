// tests/component/addPaymentMethodDialog.test.tsx
//
// The "Add payment method" widget (Req 2.1, 5.4). The critical guarantee is
// that a card token — never the raw card number/CVC/expiry — is what reaches
// the server action.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getTokenisationConfig = vi.fn();
const attachPaymentSource = vi.fn();

vi.mock('@/lib/actions/payments', () => ({
  getTokenisationConfig: (...args: unknown[]) => getTokenisationConfig(...args),
  attachPaymentSource: (...args: unknown[]) => attachPaymentSource(...args),
}));

// The dialog refreshes the route after a save so the page showing the saved
// card re-renders. There is no app router in a component test, so stub it.
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const createToken = vi.fn();
vi.mock('@/components/payments/usePinchCapture', () => ({
  usePinchCapture: (publishableKey: string | null) => ({
    status: publishableKey ? 'ready' : 'idle',
    capture: publishableKey ? { createToken } : null,
    error: null,
  }),
}));

import { AddPaymentMethodDialog } from '@/components/payments/AddPaymentMethodDialog';

describe('AddPaymentMethodDialog', () => {
  beforeEach(() => {
    getTokenisationConfig.mockReset();
    attachPaymentSource.mockReset();
    createToken.mockReset();
    refresh.mockReset();
    getTokenisationConfig.mockResolvedValue({
      ok: true,
      data: { publishableKey: 'pk_test_123', environment: 'test' },
    });
  });

  it('sends only the token to attachPaymentSource, never the raw card number', async () => {
    createToken.mockResolvedValue({ token: 'tok_abc123' });
    attachPaymentSource.mockResolvedValue({ ok: true, data: { sourceId: 'src_1' } });

    const user = userEvent.setup();
    render(<AddPaymentMethodDialog />);

    await user.click(screen.getByRole('button', { name: /add payment method/i }));
    await waitFor(() => expect(getTokenisationConfig).toHaveBeenCalled());

    await user.type(screen.getByLabelText(/name on card/i), 'Jane Buyer');
    await user.type(screen.getByLabelText(/card number/i), '4242 4242 4242 4242');
    await user.type(screen.getByLabelText(/cvc/i), '123');
    await user.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => expect(attachPaymentSource).toHaveBeenCalledTimes(1));
    expect(attachPaymentSource).toHaveBeenCalledWith('tok_abc123', 'credit-card', {
      last4: '4242',
      brand: 'Visa',
    });

    // createToken (the browser-side CaptureJS call) legitimately receives the
    // raw card number — that's what tokenisation means. The invariant we care
    // about is that the SERVER action never sees it, only the resulting token.
    expect(JSON.stringify(attachPaymentSource.mock.calls)).not.toContain('4242424242424242');
    expect(attachPaymentSource.mock.calls[0]).toEqual(['tok_abc123', 'credit-card', {
      last4: '4242',
      brand: 'Visa',
    }]);
  });

  it('calls onAttached after a successful save', async () => {
    createToken.mockResolvedValue({ token: 'tok_xyz' });
    attachPaymentSource.mockResolvedValue({ ok: true, data: { sourceId: 'src_1' } });
    const onAttached = vi.fn();

    const user = userEvent.setup();
    render(<AddPaymentMethodDialog onAttached={onAttached} />);

    await user.click(screen.getByRole('button', { name: /add payment method/i }));
    await waitFor(() => expect(getTokenisationConfig).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/name on card/i), 'Jane Buyer');
    await user.type(screen.getByLabelText(/card number/i), '4242424242424242');
    await user.type(screen.getByLabelText(/cvc/i), '123');
    await user.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => expect(onAttached).toHaveBeenCalledTimes(1));
  });

  it('surfaces a server error without closing the dialog', async () => {
    createToken.mockResolvedValue({ token: 'tok_bad' });
    attachPaymentSource.mockResolvedValue({
      ok: false,
      error: 'PROVIDER_ERROR',
      message: 'The payment method could not be saved.',
    });

    const user = userEvent.setup();
    render(<AddPaymentMethodDialog />);

    await user.click(screen.getByRole('button', { name: /add payment method/i }));
    await waitFor(() => expect(getTokenisationConfig).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/name on card/i), 'Jane Buyer');
    await user.type(screen.getByLabelText(/card number/i), '4242424242424242');
    await user.type(screen.getByLabelText(/cvc/i), '123');
    await user.click(screen.getByRole('button', { name: /save card/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved/i);
    // Dialog stays open so the buyer can retry.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save card/i })).toBeInTheDocument(),
    );
  });

  it('rejects an invalid card number before calling the tokeniser', async () => {
    const user = userEvent.setup();
    render(<AddPaymentMethodDialog />);

    await user.click(screen.getByRole('button', { name: /add payment method/i }));
    await waitFor(() => expect(getTokenisationConfig).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/name on card/i), 'Jane Buyer');
    await user.type(screen.getByLabelText(/card number/i), '123');
    await user.type(screen.getByLabelText(/cvc/i), '123');
    await user.click(screen.getByRole('button', { name: /save card/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid card number/i);
    expect(createToken).not.toHaveBeenCalled();
  });
});
