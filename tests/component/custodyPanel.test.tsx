// tests/component/custodyPanel.test.tsx
//
// The solvency panel, rendered in all three states.
//
// WHY A COMPONENT TEST RATHER THAN A PAGE CHECK. `getCustodyPosition` is admin-gated
// independently of the page it renders on — which is correct, and which means the panel
// cannot be reached without a real admin session. A component test exercises the one
// thing that could silently regress: which state renders which words.
//
// The assertion that matters is the UNKNOWN case. If a future refactor makes an
// unreadable balance render as covered, the panel becomes a false all-clear and nothing
// else in the system would notice.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CustodyPanel } from '@/components/admin/CustodyPanel';
import type { CustodyReport } from '@/lib/actions/admin';

function report(overrides: Partial<CustodyReport> = {}): CustodyReport {
  return {
    state: 'SOLVENT',
    heldForMembersCents: 10_000,
    providerBalanceCents: 15_000,
    shortfallCents: 0,
    surplusCents: 5_000,
    saleCount: 1,
    currency: 'aud',
    unreadableReason: null,
    ...overrides,
  };
}

describe('CustodyPanel', () => {
  it('reports funds covered, with the headroom', () => {
    render(<CustodyPanel position={report()} />);

    expect(screen.getByText('Funds covered')).toBeInTheDocument();
    expect(screen.getByText('Headroom')).toBeInTheDocument();
    expect(screen.getByText('$150.00')).toBeInTheDocument();
    // No alarm copy when nothing is wrong.
    expect(screen.queryByText(/Automatic payouts/)).not.toBeInTheDocument();
  });

  it('reports a shortfall and names the likely causes in order', () => {
    render(
      <CustodyPanel
        position={report({
          state: 'SHORTFALL',
          providerBalanceCents: 4_000,
          shortfallCents: 6_000,
          surplusCents: 0,
        })}
      />,
    );

    expect(screen.getByText('Shortfall')).toBeInTheDocument();
    expect(screen.getByText('Short by')).toBeInTheDocument();
    expect(screen.getByText('$60.00')).toBeInTheDocument();
    // An operator seeing red for the first time needs somewhere to look. Automatic
    // payouts lead because a commingled balance being swept is the most likely cause.
    expect(screen.getByText(/Automatic payouts/)).toBeInTheDocument();
    expect(screen.getByText(/Chargebacks/)).toBeInTheDocument();
  });

  it('says unknown — not covered — when the balance could not be read', () => {
    render(
      <CustodyPanel
        position={report({
          state: 'UNKNOWN',
          providerBalanceCents: 0,
          shortfallCents: 0,
          surplusCents: 0,
          unreadableReason: 'Mock provider holds no real balance',
        })}
      />,
    );

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
    expect(screen.getByText(/Mock provider holds no real balance/)).toBeInTheDocument();

    // The critical negative: nothing on this panel may imply solvency.
    expect(screen.queryByText('Funds covered')).not.toBeInTheDocument();
    expect(screen.queryByText('Shortfall')).not.toBeInTheDocument();

    // What is owed is still shown — that half is knowable and useful alone.
    expect(screen.getByText('$100.00')).toBeInTheDocument();
  });

  it('pluralises the sale count', () => {
    const { unmount } = render(<CustodyPanel position={report({ saleCount: 1 })} />);
    expect(screen.getByText(/Across 1 sale\b/)).toBeInTheDocument();
    unmount();

    render(<CustodyPanel position={report({ saleCount: 3 })} />);
    expect(screen.getByText(/Across 3 sales/)).toBeInTheDocument();
  });
});
