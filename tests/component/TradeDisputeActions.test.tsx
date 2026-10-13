// tests/component/TradeDisputeActions.test.tsx
//
// The staff dispute console (ESC-01, ESC-10, R4-M1, R4-N4). What it must never do:
// offer "undo the trade" on a trade that reached inspection, or let Unfounded /
// Condition through on a never-inspected trade without the staff attestation that the
// goods changed hands (otherwise a no-show filing first could get the other side's
// money released).

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveTradeDispute = vi.fn(async () => ({
  ok: true,
  data: { id: 't1', state: 'COMPLETED', outcome: 'UNFOUNDED', manualReconciliation: false },
}));
vi.mock('@/lib/actions/admin', () => ({
  resolveTradeDispute: (...args: unknown[]) => resolveTradeDispute(...(args as [])),
  setDisputeCustodyScope: vi.fn(async () => ({ ok: true, data: { id: 't1', scope: 'ALL' } })),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TradeDisputeActions, type TradeDisputeActionsProps } from '@/components/admin/TradeDisputeActions';
import type { TradeResolutionParty } from '@/lib/actions/arbitration';

function party(id: string, name: string, overrides: Partial<TradeResolutionParty> = {}): TradeResolutionParty {
  return {
    id,
    name,
    bondCents: 50_000,
    remainingCents: 50_000,
    holdState: 'HELD',
    holdExpiresAt: '2026-10-15T00:00:00.000Z',
    receivedAt: null,
    ...overrides,
  };
}

function props(overrides: Partial<TradeDisputeActionsProps> = {}): TradeDisputeActionsProps {
  return {
    tradeId: 't1',
    initiator: party('a', 'Alex'),
    counterpart: party('b', 'Blake'),
    fraudClaimedById: null,
    inspected: true,
    compensationDefaultCents: 1_000,
    handoverMethod: 'IN_PERSON',
    custodyAccusedId: null,
    currency: 'aud',
    ...overrides,
  };
}

const UNDO = /The exchange didn't happen/;

beforeEach(() => resolveTradeDispute.mockClear());

describe('TradeDisputeActions', () => {
  it('hides "undo the trade" once the trade reached inspection', () => {
    render(<TradeDisputeActions {...props({ inspected: true })} />);
    expect(screen.queryByRole('button', { name: UNDO })).toBeNull();
  });

  it('offers "undo the trade" on a never-inspected trade, including after a fraud claim from LOCKED', () => {
    render(<TradeDisputeActions {...props({ inspected: false, fraudClaimedById: 'b' })} />);
    expect(screen.getByRole('button', { name: UNDO })).toBeTruthy();
  });

  it('requires the attestation for Unfounded only when the trade was never inspected', () => {
    const { unmount } = render(<TradeDisputeActions {...props({ inspected: false })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unfounded' }));
    const resolve = screen.getByRole('button', { name: 'Resolve' });
    expect(resolve).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox', { name: /The goods did change hands/ }));
    expect(resolve).toHaveProperty('disabled', false);
    unmount();

    render(<TradeDisputeActions {...props({ inspected: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unfounded' }));
    expect(screen.queryByRole('checkbox', { name: /The goods did change hands/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Resolve' })).toHaveProperty('disabled', false);
  });

  it('requires the attestation for Condition on a never-inspected trade, but not for undo', () => {
    render(<TradeDisputeActions {...props({ inspected: false })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Condition' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alex' }));
    expect(screen.getByRole('button', { name: 'Resolve' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: UNDO }));
    expect(screen.queryByRole('checkbox', { name: /The goods did change hands/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Resolve' })).toHaveProperty('disabled', false);
  });

  it('defaults condition compensation to the smaller of the default and what the collateral can pay', () => {
    render(
      <TradeDisputeActions
        {...props({ counterpart: party('b', 'Blake', { remainingCents: 600 }), compensationDefaultCents: 1_000 })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Condition' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alex' }));
    expect((screen.getByLabelText(/Compensation from Blake/) as HTMLInputElement).value).toBe('6.00');
  });

  it('only offers the no-collateral override when the offender has nothing capturable', () => {
    const { unmount } = render(<TradeDisputeActions {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fraud' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alex' }));
    expect(screen.queryByRole('checkbox', { name: /No collateral left/ })).toBeNull();
    unmount();

    render(
      <TradeDisputeActions {...props({ counterpart: party('b', 'Blake', { holdState: 'NONE', remainingCents: 0 }) })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fraud' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alex' }));
    expect(screen.getByRole('button', { name: 'Resolve' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox', { name: /No collateral left/ }));
    expect(screen.getByRole('button', { name: 'Resolve' })).toHaveProperty('disabled', false);
  });

  it('shows each side\'s receipt and the partial-delivery hint on a posted trade (R4-N4)', () => {
    render(
      <TradeDisputeActions
        {...props({
          handoverMethod: 'DELIVERY',
          initiator: party('a', 'Alex', { receivedAt: '2026-10-12T00:00:00.000Z' }),
        })}
      />,
    );
    expect(screen.getByTestId('received-a').textContent).toMatch(/Confirmed receipt/);
    expect(screen.getByTestId('received-b').textContent).toMatch(/Has not confirmed receipt/);
    expect(screen.getByText(/If one card arrived, use Condition or Fraud/)).toBeTruthy();
  });

  it('never describes collateral as escrow', () => {
    const { container } = render(<TradeDisputeActions {...props()} />);
    expect(container.textContent?.toLowerCase()).not.toContain('escrow');
  });
});
