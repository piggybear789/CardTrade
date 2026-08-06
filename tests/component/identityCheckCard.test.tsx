// tests/component/identityCheckCard.test.tsx
//
// Step ONE of verification, in the UI (0069).
//
// The guarantees worth pinning down, all of them things this card got wrong in an
// earlier shape or would be easy to get wrong again:
//   * asking to verify leaves for the provider in ONE action — no intermediate
//     "save your details" screen, and no local form at all;
//   * NO document, bank, date-of-birth or address field exists in our DOM. Stripe
//     collects the document on its own pages, so those inputs must not be here to be
//     accidentally wired up later;
//   * a FAILED check offers a retry rather than reading as a dead end — a document
//     check fails for a blurry photo far more often than for anything sinister;
//   * the verified view shows the provider-reported name and nothing private;
//   * the card never mentions bank details, because this step does not need them —
//     that separation is the whole point of splitting the gate from Connect.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const beginIdentityCheck = vi.fn();

vi.mock('@/lib/actions/identity', () => ({
  beginIdentityCheck: (...args: unknown[]) => beginIdentityCheck(...args),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { IdentityCheckCard } from '@/components/identity/IdentityCheckCard';

// `window.location.assign` is how the card leaves for the provider; jsdom does not
// implement navigation, so it is replaced with a spy.
const assign = vi.fn();

beforeEach(() => {
  beginIdentityCheck.mockReset();
  assign.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
});

describe('IdentityCheckCard', () => {
  it('leaves for the provider in one action', async () => {
    beginIdentityCheck.mockResolvedValue({
      ok: true,
      data: { url: 'https://verify.stripe.com/start/abc', sessionId: 'vs_1' },
    });

    render(<IdentityCheckCard status="NONE" />);

    await userEvent.click(screen.getByRole('button', { name: /verify with stripe/i }));

    expect(beginIdentityCheck).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('https://verify.stripe.com/start/abc');
  });

  it('collects NOTHING locally — no document, bank, DOB or address field', () => {
    render(<IdentityCheckCard status="NONE" />);

    // Any textbox at all would be a field we own in a path that must stay
    // provider-owned, so this asserts the absence of the whole category.
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(document.querySelectorAll('input')).toHaveLength(0);
  });

  it('offers a retry after a failed check rather than a dead end', async () => {
    render(<IdentityCheckCard status="FAILED" />);

    expect(screen.getByText(/could not be verified/i)).toBeInTheDocument();
    // The retry is a real, enabled control — not prose telling them to contact support.
    const retry = screen.getByRole('button', { name: /try again/i });
    expect(retry).toBeEnabled();
  });

  it('reports an in-progress check without offering a verified badge', () => {
    render(<IdentityCheckCard status="PENDING" />);

    expect(screen.getByText(/being checked/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Verified as/i)).not.toBeInTheDocument();
  });

  it('shows the provider-reported name once verified, and no action', () => {
    render(<IdentityCheckCard status="VERIFIED" verifiedName="Ada Lovelace" />);

    expect(screen.getByText(/Verified as Ada Lovelace/i)).toBeInTheDocument();
    // Nothing left to do, so nothing to press.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('never asks for bank details — that is step two', () => {
    // The split is only real if the copy honours it. A member reading this card must
    // not come away thinking they need their bank account to start selling.
    const { container } = render(<IdentityCheckCard status="NONE" />);

    expect(container.textContent).not.toMatch(/bsb|account number|bank account/i);
    expect(container.textContent).toMatch(/no bank details/i);
  });

  it('says photo ID, which only became true when the check became a real document check', () => {
    // Before 0069 the gate was Connect, which can defer document collection, so this
    // wording would have overstated the assurance. It is now accurate.
    const { container } = render(<IdentityCheckCard status="NONE" />);

    expect(container.textContent).toMatch(/photo ID/i);
  });
});
