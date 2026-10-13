// tests/component/listingPane.test.tsx
//
// The listing page's right-hand pane after the declutter pass: no chip row, one muted
// fee note, one protection line, a borderless seller row that always shows a rating,
// and a status badge only when the listing is not available.

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

// Pulls in report server actions that have nothing to do with the pane.
vi.mock('@/components/reports/ReportDialog', () => ({
  ReportDialog: () => null,
}));

import { ListingDesktopPane } from '@/components/listings/ListingDesktopPane';
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
    expect(screen.getByText('Pokémon · Graded · Croydon, NSW, Australia')).toBeInTheDocument();
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
    expect(screen.getByText(/^Multiple items · nothing is held/)).toBeInTheDocument();
  });
});
