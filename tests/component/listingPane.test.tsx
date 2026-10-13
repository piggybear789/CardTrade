// tests/component/listingPane.test.tsx
//
// The listing page's right-hand pane after the declutter pass: no badge chip row, one
// muted fee note for buyers, one protection line, a borderless seller row that always
// shows a rating, a status badge only when the listing is not available, the save count
// as the last clause of the meta line, and the round action-chip row
// (`ListingActionRow`, Message seller's `action` chip) under Buy now.

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

// Pulls in report server actions that have nothing to do with the pane.
vi.mock('@/components/reports/ReportDialog', () => ({
  ReportDialog: () => null,
}));

import { ListingActionRow } from '@/components/listings/ListingActionIcon';
import { ListingDesktopPane, listingMetaLine } from '@/components/listings/ListingDesktopPane';
import { MessageSellerButton } from '@/components/messages/MessageSellerButton';
import { ListingSellerRow } from '@/components/listings/ListingSellerRow';
import { ListingFeeNote, ListingProtectionLine } from '@/components/listings/ListingTrust';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';

const identity = {
  nameIsDocumentVerified: true,
  legalEntityName: 'Jane Citizen',
  tradingName: null,
} as unknown as SellerIdentityDisclosure;

describe('ListingFeeNote', () => {
  it('names the buyer fee in muted text with the breakdown trigger', () => {
    const { container } = render(<ListingFeeNote priceCents={40_000_000} currency="aud" />);
    expect(screen.getByText('Includes $20,000.00 buyer fee')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Price includes the NoDitto fee. Show breakdown' }),
    ).toBeInTheDocument();
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

describe('ListingSellerRow', () => {
  const base = {
    headingId: 'seller-heading',
    sellerId: 'seller-1',
    name: 'Jane',
    isOwner: false,
    avatarPath: null,
    verified: true,
    firstName: 'Jane',
    rating: null,
    ratingCount: undefined,
    identity: null,
  };

  it('always renders a rating line, even with no ratings', () => {
    render(<ListingSellerRow {...base} />);
    expect(screen.getByText('No ratings yet')).toBeInTheDocument();
    expect(screen.getByText('Name not verified yet')).toBeInTheDocument();
  });

  it('shows the verified real name and links to the seller', () => {
    render(<ListingSellerRow {...base} identity={identity} />);
    expect(screen.getByText('Real name')).toBeInTheDocument();
    expect(screen.getByText('Jane Citizen')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/sellers/seller-1');
  });

  it("links the owner to their own profile", () => {
    render(<ListingSellerRow {...base} name="You" isOwner />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/profile');
  });
});

describe('ListingDesktopPane', () => {
  const props = {
    title: 'Charizard',
    description: 'Clean slab.',
    priceCents: 10_000,
    currency: 'aud',
    isShopfront: false,
    itemId: 'item-1',
    isOwner: false,
    showWatch: false,
    canReport: false,
    showTrust: true,
    category: 'Pokémon',
    condition: 'Graded',
    watchCount: 3,
    initialWatching: false,
    sellerId: 'seller-1',
    sellerDisplayName: 'Jane',
    sellerAvatarPath: null,
    sellerVerified: false,
    sellerFirstName: null,
    sellerRating: null,
    sellerRatingCount: undefined,
    sellerIdentity: null,
    locationLabel: 'Croydon, NSW, Australia',
    createdAt: null,
  };

  it('shows no chip row for an available listing, and one quiet meta line', () => {
    const { container } = render(
      <ListingDesktopPane {...props} statusBadge={null}>
        <button type="button">Buy now</button>
      </ListingDesktopPane>,
    );
    expect(screen.queryByLabelText(/^Availability:/)).toBeNull();
    expect(
      screen.getByText('Pokémon · Graded · Croydon, NSW, Australia · 3 saved'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Single item/)).toBeNull();
    expect(screen.queryByText(/Message seller/)).toBeNull();
    expect(screen.getByText('No ratings yet')).toBeInTheDocument();
    expect(container.querySelector('.text-trust')).toBeNull();
  });

  it('shows a status badge when the listing is not available', () => {
    render(
      <ListingDesktopPane {...props} statusBadge={{ label: 'Sold', variant: 'outline' }}>
        <span />
      </ListingDesktopPane>,
    );
    expect(screen.getByLabelText('Availability: Sold')).toHaveTextContent('Sold');
  });

  it('says nothing is held on a binder or bulk listing', () => {
    render(
      <ListingDesktopPane {...props} isShopfront statusBadge={null}>
        <span />
      </ListingDesktopPane>,
    );
    expect(
      screen.getByText(/^Binder or bulk listing · nothing is held/),
    ).toBeInTheDocument();
  });

  it('shows the fee note to a buyer and not to the owner', () => {
    const { unmount } = render(
      <ListingDesktopPane {...props} statusBadge={null}>
        <span />
      </ListingDesktopPane>,
    );
    expect(screen.getByText(/buyer fee/)).toBeInTheDocument();
    unmount();

    render(
      <ListingDesktopPane {...props} isOwner showTrust={false} statusBadge={null}>
        <span />
      </ListingDesktopPane>,
    );
    expect(screen.queryByText(/buyer fee/)).toBeNull();
  });

  it("falls back to 'Seller' when the seller has no display name", () => {
    render(
      <ListingDesktopPane {...props} sellerDisplayName={null} statusBadge={null}>
        <span />
      </ListingDesktopPane>,
    );
    // The row's sr-only heading also reads "Seller"; the name is the `span` match.
    expect(screen.getAllByText('Seller').some((el) => el.tagName === 'SPAN')).toBe(true);
    expect(screen.queryByText('Unknown seller')).toBeNull();
  });
});

describe('listingMetaLine', () => {
  const base = {
    isShopfront: false,
    category: 'Pokémon',
    condition: 'Graded',
    locationLabel: null,
    listedAgo: null,
  };

  it('omits the save clause when nobody has saved it', () => {
    expect(listingMetaLine({ ...base, saves: 0 })).toBe('Pokémon · Graded');
  });

  it('ends with the save count when someone has', () => {
    expect(listingMetaLine({ ...base, saves: 1 })).toBe('Pokémon · Graded · 1 saved');
  });
});

describe('ListingActionRow', () => {
  it('lays out only the chips that are present', () => {
    render(
      <ListingActionRow label="Other ways to deal">
        <button type="button">A</button>
        {null}
        <button type="button">B</button>
      </ListingActionRow>,
    );
    const row = screen.getByRole('group', { name: 'Other ways to deal' });
    expect(row.querySelectorAll('button')).toHaveLength(2);
  });

  it('renders nothing when no chip is present', () => {
    const { container } = render(
      <ListingActionRow label="Other ways to deal">
        {null}
        {false}
      </ListingActionRow>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('MessageSellerButton', () => {
  it('draws the round chip for the action row', () => {
    render(<MessageSellerButton itemId="item-1" sellerId="seller-1" variant="action" />);
    const button = screen.getByRole('button', { name: 'Message seller' });
    expect(button.querySelector('.md\\:rounded-full')).not.toBeNull();
  });

  it('is an outline button by default, not tinted', () => {
    render(<MessageSellerButton itemId="item-1" sellerId="seller-1" />);
    const button = screen.getByRole('button', { name: 'Message seller' });
    expect(button.className).not.toContain('bg-secondary');
    expect(button.className).toContain('bg-card');
  });
});
