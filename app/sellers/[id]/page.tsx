// app/sellers/[id]/page.tsx
//
// Public seller profile (Phase 5). A dynamic Server Component that shows a
// seller's public identity (display name, aggregate rating, Verified badge),
// their AVAILABLE listings, and the reviews other traders have left about them.
//
// All seller fields come from the catalog-safe `public_profiles` view (never
// contact email / raw KYC status). Listings are read from `items` (RLS exposes
// AVAILABLE rows publicly). Reviews come from `getReviewsFor` (public select).

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, ShieldCheck, Store } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { getReviewsFor } from '@/lib/actions/reviews';
import { loadSellerIdentityDisclosure } from '@/lib/sellerIdentity';
import { ItemCard } from '@/components/listings/ItemCard';
import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { ReviewList } from '@/components/reviews/ReviewList';
import { ReportDialog } from '@/components/reports/ReportDialog';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { EmptyState } from '@/components/ui/empty-state';
import { StarRating } from '@/components/listings/StarRating';
import { Avatar } from '@/components/ui/avatar';
import { SocialLinksDisplay } from '@/components/profile/SocialLinksDisplay';
import type {
  CatalogItem,
  CatalogSeller,
  ItemRow,
} from '@/lib/actions/listings';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// Reflects live ratings / listings, so it must render dynamically.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('public_profiles')
    .select('display_name')
    .eq('id', id)
    .maybeSingle();
  const name = (data?.display_name as string | null) ?? 'Seller';
  return { title: `${name} · NoDitto` };
}

export default async function SellerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Public, catalog-safe seller identity.
  const { data: sellerRow } = await supabase
    .from('public_profiles')
    .select(
      'id, display_name, rating, rating_count, is_verified, identity_first_name, avatar_path, social_links',
    )
    .eq('id', id)
    .maybeSingle();

  if (!sellerRow) {
    notFound();
  }

  // Resolve the viewer so we can offer a report affordance when an authenticated
  // user is viewing *someone else's* profile (never their own).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const canReport = Boolean(user) && user!.id !== id;

  const seller: CatalogSeller = {
    id: sellerRow.id as string,
    displayName: (sellerRow.display_name as string | null) ?? null,
    rating: (sellerRow.rating as number | null) ?? null,
    ratingCount: (sellerRow.rating_count as number | null) ?? 0,
    isVerified: Boolean(sellerRow.is_verified),
    identityFirstName: (sellerRow.identity_first_name as string | null) ?? null,
    avatarPath: (sellerRow.avatar_path as string | null) ?? null,
  };

  // Narrow, buyer-safe merchant identity — only populated once provider
  // compliance has approved this seller (Req 4.8-4.12). Never exposes contact,
  // bank, document, credential, or compliance-note fields.
  const sellerIdentity = await loadSellerIdentityDisclosure(id);

  // The seller's AVAILABLE listings (RLS allows AVAILABLE reads publicly).
  const { data: itemsData } = await supabase
    .from('items')
    .select('*')
    .eq('owner_id', id)
    .eq('status', 'AVAILABLE')
    // A closed shopfront takes no new contracts, so it must not appear on the
    // seller's public profile either (0064).
    .is('closed_at', null)
    .eq('hidden', false)
    .order('created_at', { ascending: false });

  const items = (itemsData ?? []) as ItemRow[];
  const catalogItems: CatalogItem[] = items.map((item) => ({
    ...item,
    seller,
  }));

  // Reviews written about this seller.
  const reviews = await getReviewsFor(id);

  const displayName = seller.displayName ?? 'Unknown seller';

  return (
    <MarketplaceShell title="Seller">
      <nav className="mb-6" aria-label="Breadcrumb">
        <Link
          href="/listings"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Back to listings
        </Link>
      </nav>

      {/* Header */}
      <header className="mb-8 space-y-2 border-b pb-6">
        <div className="flex items-start justify-between gap-4">
          {/* The avatar sits OUTSIDE the name/rating column so it stays a fixed
              square beside a wrapping name rather than being pushed around by it.
              Decorative: the name is the h2 immediately beside it. */}
          <div className="flex min-w-0 items-start gap-4">
            <Avatar
              avatarPath={seller.avatarPath}
              displayName={displayName}
              size="xl"
            />
            <div className="min-w-0 space-y-2">
            {/* The shell rail already renders the page h1 ("Seller"), so the
                name is an h2 to keep the document outline hierarchical —
                mirroring the listing detail page. */}
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 break-words text-3xl font-semibold tracking-[-0.025em]">
                {displayName}
              </h2>
              {/* ONE mark. This row used to also render a <VerifiedBadge/>, on the
                  since-retired belief that payee onboarding and an identity check
                  were separate gates. They are the same gate — both badges read
                  `seller.isVerified` — so the page asserted the same fact twice in
                  two different glyphs. Labelled rather than icon-only because a
                  profile page is where a buyer goes to decide about a person. */}
              <IdentityBadge
                verified={seller.isVerified}
                firstName={seller.identityFirstName}
                size={16}
              />
            </div>
            {reviews.length > 0 ? (
              <Link
                href="#reviews"
                className="w-fit rounded-sm transition-colors hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Jump to ${reviews.length} reviews`}
              >
                <StarRating rating={seller.rating} count={seller.ratingCount} size={18} />
              </Link>
            ) : (
              <StarRating rating={seller.rating} count={seller.ratingCount} size={18} />
            )}
            <SocialLinksDisplay socialLinks={sellerRow.social_links as Record<string, string> | null} />
          </div>
          </div>

          {canReport && (
            <ReportDialog
              targetType="user"
              targetId={id}
              triggerLabel="Report user"
              triggerVariant="destructive"
            />
          )}
        </div>

        {sellerIdentity ? (
          <div className="mt-3 rounded-lg border bg-muted/30 p-4">
            <div className="text-trust mb-3 flex items-center gap-2 text-sm font-medium">
              {/* Same glyph as IdentityBadge: one fact, one icon vocabulary. */}
              <ShieldCheck className="h-4 w-4" aria-hidden />
              DittoShield verified through Stripe
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              {sellerIdentity.tradingName ? (
                <div className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Store className="h-3.5 w-3.5" aria-hidden />
                    Store
                  </dt>
                  <dd className="break-words text-sm font-medium">
                    {sellerIdentity.tradingName}
                  </dd>
                </div>
              ) : null}
              <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" aria-hidden />
                  Verified name
                </dt>
                <dd className="break-words text-sm font-medium">
                  {sellerIdentity.legalEntityName}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Verified</dt>
                <dd className="text-sm">
                  {new Date(sellerIdentity.verifiedAt).toLocaleDateString('en-AU')}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </header>

      {/* Listings */}
      <section aria-labelledby="listings-heading" className="mb-10">
        <h2 id="listings-heading" className="mb-4 text-xl font-semibold">
          Available listings
        </h2>
        {catalogItems.length === 0 ? (
          <EmptyState
            title="No Available Listings"
            titleAs="h3"
            description="This seller has no available listings right now."
            compact
          />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
            {catalogItems.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      {/* Reviews */}
      <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24">
        <h2 id="reviews-heading" className="mb-4 text-xl font-semibold">
          Reviews {reviews.length > 0 ? `(${reviews.length})` : ''}
        </h2>
        <ReviewList reviews={reviews} revieweeName={displayName} />
      </section>
    </MarketplaceShell>
  );
}
