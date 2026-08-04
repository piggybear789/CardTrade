// tests/component/addPaymentMethodDialog.test.tsx
//
// The "Add payment method" widget (Req 2.1, 5.4).
//
// The guarantee is stronger than it was under CaptureJS. Previously the form
// owned card inputs and we asserted that only the resulting token reached the
// server. Now Stripe renders the fields inside its own iframe, so there is no
// card number, expiry, or CVC anywhere in this component's state — the only thing
// our code ever handles is an opaque SetupIntent id.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const beginCardSetup = vi.fn();
const completeCardSetup = vi.fn();

vi.mock('@/lib/actions/payments', () => ({
  beginCardSetup: (...args: unknown[]) => beginCardSetup(...args),
  completeCardSetup: (...args: unknown[]) => completeCardSetup(...args),
}));

// The dialog refreshes the route after a save so the page showing the saved
// card re-renders. There is no app router in a component test, so stub it.
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const confirmSetup = vi.fn();
const loadStripe = vi.fn((_publishableKey: string) => Promise.resolve({}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: (publishableKey: string) => loadStripe(publishableKey),
}));

// Stand in for Stripe's iframe-backed Elements. `PaymentElement` renders a
// placeholder and fires onReady, mirroring the real mount lifecycle without a
// network call or a real iframe.
vi.mock('@stripe/react-stripe-js', async () => {
  const { useEffect } = await import('react');
  return {
    Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PaymentElement: ({ onReady }: { onReady?: () => void }) => {
      // After mount, not during render — matching the real Element's lifecycle.
      useEffect(() => onReady?.(), [onReady]);
      return <div data-testid="stripe-payment-element" />;
    },
    useStripe: () => ({ confirmSetup: (...args: unknown[]) => confirmSetup(...args) }),
    useElements: () => ({}),
  };
});

import { AddPaymentMethodDialog } from '@/components/payments/AddPaymentMethodDialog';

/** Open the dialog and wait for the setup session to resolve. */
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /add payment method/i }));
  await waitFor(() => expect(beginCardSetup).toHaveBeenCalled());
}

describe('AddPaymentMethodDialog', () => {
  beforeEach(() => {
    beginCardSetup.mockReset();
    completeCardSetup.mockReset();
    confirmSetup.mockReset();
    loadStripe.mockClear();
    refresh.mockReset();

    beginCardSetup.mockResolvedValue({
      ok: true,
      data: {
        setupId: 'seti_abc123',
        clientSecret: 'seti_abc123_secret_xyz',
        publishableKey: 'pk_test_123',
      },
    });
    confirmSetup.mockResolvedValue({ error: undefined });
    completeCardSetup.mockResolvedValue({
      ok: true,
      data: { sourceId: 'pm_1', label: 'Visa •••• 4242' },
    });
  });

  it('mounts Stripe Payment Element rather than collecting card fields itself', async () => {
    const user = userEvent.setup();
    render(<AddPaymentMethodDialog />);
    await openDialog(user);

    expect(await screen.findByTestId('stripe-payment-element')).toBeInTheDocument();
    expect(loadStripe).toHaveBeenCalledWith('pk_test_123');

    // The card inputs the CaptureJS form used to own must not exist here.
    expect(screen.queryByLabelText(/card number/i)).toBeNull();
    expect(screen.queryByLabelText(/cvc/i)).toBeNull();
  });

  it('passes only the opaque setup id to the server, never card data', async () => {
    const user = userEvent.setup();
    render(<AddPaymentMethodDialog />);
    await openDialog(user);

    await user.click(await screen.findByRole('button', { name: /save card/i }));

    await waitFor(() => expect(completeCardSetup).toHaveBeenCalledTimes(1));
    expect(completeCardSetup).toHaveBeenCalledWith('seti_abc123');

    // Confirmation happens entirely inside Stripe.js; our call carries no
    // instrument details at all.
    expect(confirmSetup).toHaveBeenCalledTimes(1);
    const confirmArgs = JSON.stringify(confirmSetup.mock.calls[0]);
    expect(confirmArgs).not.toContain('4242');
    expect(confirmSetup.mock.calls[0][0]).toMatchObject({ redirect: 'if_required' });
  });

  it('calls onAttached after a successful save', async () => {
    const onAttached = vi.fn();
    const user = userEvent.setup();
    render(<AddPaymentMethodDialog onAttached={onAttached} />);
    await openDialog(user);

    await user.click(await screen.findByRole('button', { name: /save card/i }));

    await waitFor(() => expect(onAttached).toHaveBeenCalledTimes(1));
  });

  it('surfaces a card error from Stripe without saving or closing', async () => {
    confirmSetup.mockResolvedValue({ error: { message: 'Your card was declined.' } });

    const user = userEvent.setup();
    render(<AddPaymentMethodDialog />);
    await openDialog(user);
    await user.click(await screen.findByRole('button', { name: /save card/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/declined/i);
    expect(completeCardSetup).not.toHaveBeenCalled();
    // Dialog stays open and the button becomes usable again so the buyer can
    // retry. `waitFor` because the error text and the cleared `isPending` land in
    // separate commits: setError renders inside the transition, and the button
    // only leaves its "Saving…" state once the transition settles.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save card/i })).toBeEnabled(),
    );
  });

  it('surfaces a server error without closing the dialog', async () => {
    completeCardSetup.mockResolvedValue({
      ok: false,
      error: 'PROVIDER_ERROR',
      message: 'The payment method could not be saved.',
    });

    const user = userEvent.setup();
    render(<AddPaymentMethodDialog />);
    await openDialog(user);
    await user.click(await screen.findByRole('button', { name: /save card/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved/i);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save card/i })).toBeInTheDocument(),
    );
  });

  it('reports a failure to open the setup session', async () => {
    beginCardSetup.mockResolvedValue({
      ok: false,
      error: 'NOT_SUPPORTED',
      message: 'The active payment provider cannot store payment methods.',
    });

    const user = userEvent.setup();
    render(<AddPaymentMethodDialog />);
    await openDialog(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot store payment methods/i);
    expect(loadStripe).not.toHaveBeenCalled();
  });

  it('falls back to a simulated card when no real provider is configured', async () => {
    // The MockService returns this sentinel key; Stripe.js would reject it, so
    // the form must not try to mount Payment Element with it.
    beginCardSetup.mockResolvedValue({
      ok: true,
      data: {
        setupId: 'seti_mock',
        clientSecret: 'seti_mock_secret_mock',
        publishableKey: 'pk_test_mock',
      },
    });

    const user = userEvent.setup();
    render(<AddPaymentMethodDialog />);
    await openDialog(user);

    expect(await screen.findByRole('button', { name: /save demo card/i })).toBeInTheDocument();
    expect(loadStripe).not.toHaveBeenCalled();
    expect(screen.queryByTestId('stripe-payment-element')).toBeNull();

    await user.click(screen.getByRole('button', { name: /save demo card/i }));
    await waitFor(() => expect(completeCardSetup).toHaveBeenCalledWith('seti_mock'));
  });
});
