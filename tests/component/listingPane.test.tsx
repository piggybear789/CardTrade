// tests/component/listingPane.test.tsx
//
// The listing page's right-hand pane and phone stack, restored to the design before
// 81ca4e8 (Watch and Report beside the title, seller card, actions pinned to the
// bottom), with three pieces kept from the later redesign: the fee-inclusive price,
// the muted "Includes $X buyer fee" note under it, and the one-line buyer protection
// strip. While fees are waived for the beta (`BETA_FEE_WAIVER`) the note reads
// "No fees for now (normally 5%)" instead, so the assertions branch on the switch.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/listings/item-1',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

vi.mock('@/lib/actions/watchlist', () => ({
  toggleWatch: vi.fn(),
}));

vi.mock('@/lib/actions/messages', () => ({
  getOrCreateConversation: vi.fn(),
  sendMessage: vi.fn(),
}));

// Pulls in report server actions that have nothing to do with the pane; a marker
// stands in so the test can see where Report renders.
vi.mock('@/components/reports/ReportDialog', () => ({
  ReportDialog: ({ triggerLabel }: { triggerLabel: string }) => (
    <button type="button">{triggerLabel}</button>
  ),
}));

import { ListingDesktopPane } from '@/components/listings/ListingDesktopPane';
import { ListingDetailStack } from '@/components/listings/ListingDetailStack';
import { MessageSellerButton } from '@/components/messages/MessageSellerButton';
import { ListingFeeNote, ListingProtectionLine } from '@/components/listings/ListingTrust';
import {
  FEE_POPOVER_WAIVED_TRIGGER,
  LISTING_BETA_FEE_NOTE,
  feesWaivedForBeta,
} from '@/lib/fees/feeLabels';
import { formatMoney } from '@/lib/format';
import { buyerPaysCents } from '@/lib/listings/buyerPrice';

/** The note under a single listing's price, on whichever side of the beta switch. */
const feeNote = (standardText: string) =>
  feesWaivedForBeta() ? LISTING_BETA_FEE_NOTE : standardText;

describe('ListingFeeNote', () => {
  it('names the buyer fee in muted text with the breakdown trigger', () => {
    const { container } = render(<ListingFeeNote priceCents={40_000_000} currency="aud" />);
    expect(screen.getByText(feeNote('Includes $20,000.00 buyer fee'))).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: feesWaivedForBeta()
          ? FEE_POPOVER_WAIVED_TRIGGER
          : 'Price includes the NoDitto fee. Show breakdown',
      }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain('$0.00 buyer fee');
    expect(container.querySelector('.text-trust')).toBeNull();
  });
});

describe('ListingProtectionLine', () => {
  it('says the one promise and links to how it works', () => {
    const { container } = render(<ListingProtectionLine isShopfront={false} />);
    expect(screen.getByText('Buyer protection:')).toBeInTheDocument();
    expect(container.textContent).toContain('your payment is held until you accept the card.');
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/safety');
    expect(container.textContent?.toLowerCase()).not.toContain('escrow');
  });

  it('speaks of the cards on a binder or bulk listing', () => {
    const { container } = render(<ListingProtectionLine isShopfront />);
    expect(container.textContent).toContain('until you accept the cards.');
  });
});

const sellerProps = {
  sellerId: 'seller-1',
  sellerDisplayName: 'Jane',
  sellerAvatarPath: null,
  sellerVerified: false,
  sellerFirstName: null,
  sellerRating: null,
  sellerRatingCount: undefined,
  sellerIdentity: null,
};

describe('ListingDesktopPane', () => {
  const props = {
    ...sellerProps,
    title: 'Charizard',
    description: 'Clean slab.',
    // $4,000.00 asking; the buyer pays $4,200.00 with the 5% fee, or $4,000.00 during the beta.
    priceCents: 400_000,
    currency: 'aud',
    isShopfront: false,
    itemId: 'item-1',
    isOwner: false,
    showWatch: true,
    showTrust: true,
    initialWatching: false,
    locationLabel: 'Croydon, NSW, Australia',
    createdAt: null,
  };

  it('leads with the fee-inclusive price and the buyer fee note under it', () => {
    const { container } = render(
      <ListingDesktopPane {...props}>
        <button type="button">Buy now</button>
      </ListingDesktopPane>,
    );
    expect(container.textContent).toContain(formatMoney(buyerPaysCents(400_000, 'aud'), 'aud'));
    expect(screen.getByText(feeNote('Includes $200.00 buyer fee'))).toBeInTheDocument();
  });

  it('puts Save and Report beside the title', () => {
    render(
      <ListingDesktopPane {...props}>
        <span />
      </ListingDesktopPane>,
    );
    const group = screen.getByRole('group', { name: 'Listing actions' });
    expect(group).toContainElement(screen.getByRole('button', { name: 'Save item' }));
    expect(group).toContainElement(screen.getByRole('button', { name: 'Report listing' }));
  });

  it('draws the protection strip directly under the actions', () => {
    render(
      <ListingDesktopPane {...props}>
        <button type="button">Buy now</button>
      </ListingDesktopPane>,
    );
    const buy = screen.getByRole('button', { name: 'Buy now' });
    const strip = screen.getByText('Buyer protection:');
    expect(buy.parentElement).toContainElement(strip);
    expect(buy.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows neither the fee note nor the strip to the owner', () => {
    render(
      <ListingDesktopPane {...props} isOwner showWatch={false} showTrust={false}>
        <span />
      </ListingDesktopPane>,
    );
    expect(screen.queryByText(/buyer fee/)).toBeNull();
    expect(screen.queryByText('Buyer protection:')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Listing actions' })).toBeNull();
  });

  it('labels a binder concisely, with no fee note', () => {
    render(
      <ListingDesktopPane {...props} isShopfront>
        <span />
      </ListingDesktopPane>,
    );
    expect(screen.getByText(/^Binder · /)).toBeInTheDocument();
    expect(screen.queryByText(/Multiple items/)).toBeNull();
    expect(screen.queryByText(/buyer fee/)).toBeNull();
    expect(screen.getByText(/until you accept the cards\./)).toBeInTheDocument();
  });

  it('keeps the seller card rating line for an unrated seller', () => {
    render(
      <ListingDesktopPane {...props}>
        <span />
      </ListingDesktopPane>,
    );
    expect(screen.getByText('No ratings yet')).toBeInTheDocument();
    expect(screen.getByText('Name not verified yet')).toBeInTheDocument();
  });
});

describe('ListingDetailStack', () => {
  const props = {
    ...sellerProps,
    title: 'Charizard',
    description: 'Clean slab.',
    priceCents: 400_000,
    currency: 'aud',
    condition: 'Graded',
    category: 'Pokémon',
    isShopfront: false,
    locationLabel: null,
    createdAt: null,
    watchCount: 0,
    isOwner: false,
  };

  it('shows the fee note and the protection strip to a buyer who can buy', () => {
    render(<ListingDetailStack {...props} showTrust />);
    expect(screen.getByText(feeNote('Includes $200.00 buyer fee'))).toBeInTheDocument();
    expect(screen.getByText('Buyer protection:')).toBeInTheDocument();
  });

  it('shows neither when the viewer cannot buy', () => {
    render(<ListingDetailStack {...props} showTrust={false} />);
    expect(screen.queryByText(/buyer fee/)).toBeNull();
    expect(screen.queryByText('Buyer protection:')).toBeNull();
  });

  it('labels a binder concisely', () => {
    render(<ListingDetailStack {...props} isShopfront showTrust />);
    expect(screen.getByText(/(^|· )Binder( ·|$)/)).toBeInTheDocument();
    expect(screen.queryByText(/nothing is held/)).toBeNull();
    expect(screen.queryByText(/buyer fee/)).toBeNull();
  });
});

describe('MessageSellerButton', () => {
  it('is an outline button by default, not tinted', () => {
    render(<MessageSellerButton itemId="item-1" sellerId="seller-1" />);
    const button = screen.getByRole('button', { name: 'Message seller' });
    expect(button.className).not.toContain('bg-secondary');
    expect(button.className).toContain('bg-card');
  });

  it('is filled where messaging is the page’s main action', () => {
    render(<MessageSellerButton itemId={null} sellerId="seller-1" emphasis="primary" />);
    const button = screen.getByRole('button', { name: 'Message seller' });
    expect(button.className).toContain('bg-primary');
    expect(button.className).not.toContain('bg-card');
  });
});
