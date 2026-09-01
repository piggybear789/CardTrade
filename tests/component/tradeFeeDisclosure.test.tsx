// tests/component/tradeFeeDisclosure.test.tsx
//
// The trade accept dialog states what accepting costs, before it costs anything.
//
// WHY THIS NEEDS A TEST. Both figures are disclosed elsewhere — the Exchange row of
// the contract room carries the fee, and the Collateral row explains the bond — but
// that inspector is one tab deep and, on a phone, sits behind a sheet the trader has
// no reason to open. The dialog is the last surface before the card is charged, and
// it used to read "may charge the trade fee": no percentage, no amount, and no
// collateral figure at all, because until both sides accept the Collateral tab still
// says "Nothing is on the line yet".
//
// So the regression this guards is not cosmetic. Drop the breakdown and the product
// goes back to taking money from someone who was never shown a number — which for an
// Australian marketplace is a consumer-law problem, not just a UX one.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/lib/actions/tradeNegotiation', () => ({
  acceptTradeTerms: vi.fn(),
  declineTradeOffer: vi.fn(),
  proposeTradeTerms: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

// The real row fetches card status from the server on mount. The dialog only needs it
// to report that an instrument exists, and it reports through an effect rather than
// during render — same lifecycle as the real component.
vi.mock('@/components/payments/SavedCardRow', async () => {
  const { useEffect } = await import('react');
  return {
    SavedCardRow: ({ onStatus }: { onStatus?: (hasCard: boolean) => void }) => {
      useEffect(() => onStatus?.(true), [onStatus]);
      return <div data-testid="saved-card-row" />;
    },
  };
});

// Pulls in report server actions that have nothing to do with this dialog.
vi.mock('@/components/reports/ReportDialog', () => ({
  ReportDialog: () => null,
}));

import { TradeNegotiationPanel } from '@/components/trade/TradeNegotiationPanel';
import type { TradeFacts, TradeViewerContext } from '@/domain/state-machine/types';

function facts(overrides: Partial<TradeFacts> = {}): TradeFacts {
  const noOne = { initiator: false, counterpart: false };
  return {
    // Nobody has accepted yet, which is what puts ACCEPT_TERMS on the table.
    termsAccepted: { ...noOne },
    shipped: { ...noOne },
    received: { ...noOne },
    accepted: { ...noOne },
    holdsActive: { ...noOne },
    collateralSeekFailed: false,
    handoverConfirmed: { ...noOne },
    fulfilmentMethod: 'IN_PERSON',
    ...overrides,
  };
}

const viewer: TradeViewerContext = { role: 'INITIATOR', facts: facts() };

const terms = {
  cashAmountCents: 0,
  cashDirection: 'PROPOSER_PAYS' as const,
  handoverMethod: 'IN_PERSON' as const,
  meetingLocation: null,
  meetingLat: null,
  meetingLng: null,
  meetingPlaceId: null,
  meetingAt: null,
  deliveryDetails: null,
  deliveryCostCents: null,
  offerMessage: null,
  counterpartGoodsDescription: null,
};

function renderPanel(
  acceptCost: { feeText: string; collateralText: string } | null,
) {
  return render(
    <TradeNegotiationPanel
      tradeId="trade_1"
      viewer={viewer}
      counterpartyId="bob"
      counterpartyName="Bob"
      termsVersion={1}
      terms={terms}
      acceptCost={acceptCost}
    />,
  );
}

/** Open the accept dialog the way a trader does. */
async function openAcceptDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /accept terms/i }));
  return screen.findByRole('dialog');
}

describe('trade accept dialog — cost disclosure', () => {
  beforeEach(() => {
    refresh.mockReset();
  });

  it('names the fee and the collateral before the card is touched', async () => {
    const user = userEvent.setup();
    renderPanel({ feeText: '$35.00', collateralText: '$700.00' });

    const dialog = await openAcceptDialog(user);

    // The percentage, so the number is checkable rather than merely asserted.
    expect(within(dialog).getByText('NoDitto fee (5%)')).toBeInTheDocument();
    expect(within(dialog).getByText('$35.00')).toBeInTheDocument();

    // The bond, which had no pre-acceptance surface at all before this.
    expect(within(dialog).getByText('Collateral')).toBeInTheDocument();
    expect(within(dialog).getByText('$700.00')).toBeInTheDocument();
  });

  it('distinguishes the charge from the authorisation', async () => {
    // A trader who reads "$700.00" and believes it is leaving their account has been
    // misinformed in the more alarming direction, so the two rows must not read alike.
    const user = userEvent.setup();
    renderPanel({ feeText: '$35.00', collateralText: '$700.00' });

    const dialog = await openAcceptDialog(user);

    // Exact strings, not a loose match: the description prose also mentions charging,
    // and a regex passes on that while saying nothing about the hints that sit beside
    // the two figures — which is the part a reader actually uses to tell them apart.
    expect(within(dialog).getByText('Charged to your card.')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Authorised, not charged. Released in full when the trade completes.',
      ),
    ).toBeInTheDocument();
  });

  it('no longer hedges with "may charge"', async () => {
    // The exact copy this replaced. Kept as an assertion because the hedge is what
    // made the old dialog defensible-looking while disclosing nothing.
    const user = userEvent.setup();
    renderPanel({ feeText: '$35.00', collateralText: '$700.00' });

    const dialog = await openAcceptDialog(user);

    expect(within(dialog).queryByText(/may charge the trade fee/i)).toBeNull();
  });

  it('omits the breakdown rather than quoting zero when a side is unvalued', async () => {
    // `placeBondsForAgreedTrade` refuses a trade whose side has no value, so quoting
    // "$0.00" here would promise a free hold on a trade that cannot start. The room
    // passes null instead; the dialog must still open and still explain the shape.
    const user = userEvent.setup();
    renderPanel(null);

    const dialog = await openAcceptDialog(user);

    expect(within(dialog).queryByText(/NoDitto fee/i)).toBeNull();
    expect(within(dialog).queryByText('$0.00')).toBeNull();
    expect(
      within(dialog).getByText(/the collateral is authorised against it/i),
    ).toBeInTheDocument();
  });
});
