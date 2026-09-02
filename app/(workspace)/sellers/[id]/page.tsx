// app/sellers/[id]/page.tsx
//
// Public seller profile (Phase 5). A dynamic Server Component that shows a
// seller's public identity (display name, aggregate rating, Verified badge),
// their AVAILABLE listings, and the reviews other traders have left about them.
//
// All seller fields come from the catalog-safe `public_profiles` view (never
// contact email / raw KYC status). Listings are read from `items` (RLS exposes
// AVAILABLE rows publicly). Reviews come from `getReviewsFor` (public select).

import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { Building02Icon, ShieldCheckIcon, Store01Icon } from '@hugeicons/core-free-icons';

import { createClient } from '@/lib/supabase/server';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { CARD_GAME_NAMES } from '@/lib/catalog/cardGames';
import { getReviewsFor } from '@/lib/actions/reviews';
import { loadSellerIdentityDisclosure } from '@/lib/sellerIdentity';
import { CATALOG_TILE_GRID } from '@/components/listings/catalogGrid';
import { CatalogItemCard } from '@/components/listings/ItemCard';
import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { ReviewList } from '@/components/reviews/ReviewList';
import { ReportDialog } from '@/components/reports/ReportDialog';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionLoadError } from '@/components/layout/SectionHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { StarRating } from '@/components/listings/StarRating';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { SocialLinksDisplay } from '@/components/profile/SocialLinksDisplay';
import type {
  CatalogItem,
  CatalogSeller,
  ItemRow,
} from '@/lib/actions/listings';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

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
      'id, display_name, rating, rating_count, is_verified, identity_first_name, avatar_path, social_links, bio',
    )
    .eq('id', id)
    .maybeSingle();

  if (!sellerRow) {
    notFound();
  }

  // THREE INDEPENDENT READS, ONE ROUND TRIP. Each of these needs only `id` (or
  // nothing at all), so writing them as three statements cost two round trips of
  // pure latency in front of a public, shareable page. Only the `notFound` guard
  // above genuinely has to happen first.
  const [user, sellerIdentity, { data: itemsData, error: itemsError }] =
    await Promise.all([
      // Resolve the viewer so we can offer a report affordance when an
      // authenticated user is viewing *someone else's* profile (never their own).
      getCachedAuthUser(),
      // Narrow, buyer-safe merchant identity — only populated once provider
      // compliance has approved this seller (Req 4.8-4.12). Never exposes
      // contact, bank, document, credential, or compliance-note fields.
      loadSellerIdentityDisclosure(id),
      // The seller's AVAILABLE listings (RLS allows AVAILABLE reads publicly).
      supabase
        .from('items')
        .select('*')
        .eq('owner_id', id)
        .eq('status', 'AVAILABLE')
        // A closed shopfront takes no new contracts, so it must not appear on the
        // seller's public profile either (0064).
        .is('closed_at', null)
        .eq('hidden', false)
        .in('category', CARD_GAME_NAMES)
        .order('created_at', { ascending: false }),
    ]);

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

  const items = (itemsData ?? []) as ItemRow[];
  const catalogItems: CatalogItem[] = items.map((item) => ({
    ...item,
    seller,
  }));

  const displayName = seller.displayName ?? 'Unknown seller';

  return (
    <MarketplaceShell title="Seller">
      <nav className="mb-3" aria-label="Breadcrumb">
        <Link
          href="/"
          transitionTypes={['nav-back']}
          className="text-body text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Back to marketplace
        </Link>
      </nav>

      {/* Header */}
      <header className="mb-5 space-y-2 border-b pb-4">
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
          {/* The avatar sits OUTSIDE the name/rating column so it stays a fixed
              square beside a wrapping name rather than being pushed around by it.
              Decorative: the name is the h2 immediately beside it. */}
          <div className="flex min-w-0 items-start gap-3">
            <Avatar
              avatarPath={seller.avatarPath}
              displayName={displayName}
              size="md"
            />
            <div className="min-w-0 space-y-1.5">
            {/* The shell rail already renders the page h1 ("Seller"), so the
                name is an h2 to keep the document outline hierarchical —
                mirroring the listing detail page. */}
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 break-words text-subhead font-semibold tracking-[-0.025em] md:text-head">
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
                hideNameWhen={displayName}
                size={14}
              />
            </div>
            {/* `seller.ratingCount` rather than the fetched list: it is the same
                aggregate, it arrives with the profile row, and reading it here
                is what lets the reviews themselves stream in below. */}
            {seller.ratingCount > 0 ? (
              <Link
                href="#reviews"
                className="w-fit rounded-sm border border-transparent transition-colors hover:opacity-80 focus:outline-none focus-visible:border-iris"
                aria-label={`Jump to ${seller.ratingCount} reviews`}
              >
                <StarRating rating={seller.rating} count={seller.ratingCount} size={16} />
              </Link>
            ) : (
              <StarRating rating={seller.rating} count={seller.ratingCount} size={16} />
            )}
            <SocialLinksDisplay socialLinks={sellerRow.social_links as Record<string, string> | null} />
            {/* MEMBER-AUTHORED, so it is presented as their words and nothing more.
                Deliberately NOT inside the identity disclosure block below, which
                carries provider-verified facts — putting self-written copy there
                would borrow that block's credibility for text anyone can type.
                `whitespace-pre-line` keeps intentional line breaks; `break-words`
                stops an unbroken 280-character string widening the layout. */}
            {sellerRow.bio ? (
              <p className="max-w-prose whitespace-pre-line break-words text-pretty text-body leading-relaxed text-muted-foreground">
                {sellerRow.bio as string}
              </p>
            ) : null}
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
          <div className="mt-2 rounded-lg border bg-muted p-3">
            <div className="text-trust mb-3 flex items-center gap-2 text-body font-medium">
              {/* Same glyph as IdentityBadge: one fact, one icon vocabulary. */}
              <HugeiconsIcon icon={ShieldCheckIcon} className="h-4 w-4" aria-hidden />
              Identity verified via Stripe
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              {sellerIdentity.tradingName ? (
                <div className="min-w-0">
                  <dt className="flex items-center gap-tight text-meta text-muted-foreground">
                    <HugeiconsIcon icon={Store01Icon} className="h-3.5 w-3.5" aria-hidden />
                    Store
                  </dt>
                  <dd className="break-words text-body font-medium">
                    {sellerIdentity.tradingName}
                  </dd>
                </div>
              ) : null}
              <div className="min-w-0">
                <dt className="flex items-center gap-tight text-meta text-muted-foreground">
                  <HugeiconsIcon icon={Building02Icon} className="h-3.5 w-3.5" aria-hidden />
                  Verified name
                </dt>
                <dd className="break-words text-body font-medium">
                  {sellerIdentity.legalEntityName}
                </dd>
              </div>
              <div>
                <dt className="text-meta text-muted-foreground">Verified</dt>
                <dd className="text-body">
                  {new Date(sellerIdentity.verifiedAt).toLocaleDateString('en-AU')}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </header>

      {/* Listings */}
      <section aria-labelledby="listings-heading" className="mb-8">
        {/* `text-subhead`, the size every other panel heading in the app takes —
            `CardTitle`, `DialogTitle` and `SheetTitle` are all `text-subhead
            font-semibold`. This was `text-body md:text-subhead`, which on a phone
            set a section heading at 13px: the exact size of the body copy under
            it, and two notches below the seller's name in the same outline. */}
        <h2 id="listings-heading" className="mb-3 text-subhead font-semibold md:mb-4">
          Available listings
        </h2>
        {itemsError ? (
          <SectionLoadError label="listings" />
        ) : catalogItems.length === 0 ? (
          <EmptyState
            title="No Available Listings"
            titleAs="h3"
            description="This seller has no available listings right now."
            compact
          />
        ) : (
          <div className={CATALOG_TILE_GRID}>
            {catalogItems.map((item) => (
              <CatalogItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      {/* ONLY THE LIST STREAMS. `getReviewsFor` is a two-stage fetch and awaiting
          it inline made the seller's name, badge and entire listings grid wait on
          the one section below the fold — the worst position-to-value ratio on
          the route.

          THE SECTION AND ITS HEADING STAY OUT HERE, and that is not cosmetic: a
          first cut put them inside both the fallback and the resolved child, so
          `id="reviews"` and `id="reviews-heading"` each existed twice while the
          stream was in flight. Duplicate ids are invalid, they make
          `aria-labelledby` ambiguous, and the anchor from the rating link could
          resolve to a placeholder. Rendering the frame once and suspending only
          its contents avoids all three. The count comes from the profile row's
          aggregate, so it needs no await. */}
      <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24">
        <h2
          id="reviews-heading"
          className="mb-3 text-subhead font-semibold md:mb-4"
        >
          Reviews {seller.ratingCount > 0 ? `(${seller.ratingCount})` : ''}
        </h2>
        <Suspense fallback={<SellerReviewsFallback />}>
          <SellerReviewsList sellerId={id} displayName={displayName} />
        </Suspense>
      </section>
    </MarketplaceShell>
  );
}

/**
 * Two review rows, in the shape `ReviewList` actually renders them.
 *
 * This was two free-floating `h-24` boxes separated by a 12px gap, but the list
 * is ONE bordered card with hairline-divided rows inside it — so the gap closed
 * to a 1px rule and a border appeared around the pair. Each row is a name, a
 * transaction line, a comment and a timestamp in `space-y-tight p-group`, which
 * is nearer 120px than the 96px an `h-24` reserved.
 */
function SellerReviewsFallback() {
  return (
    <ul className="divide-y rounded-lg border bg-card" aria-busy="true">
      {[0, 1].map((row) => (
        <li key={row} className="space-y-tight p-group">
          <div className="flex flex-wrap items-start justify-between gap-snug">
            <div className="min-w-0">
              <TextLines className="text-body" widths={['w-24']} />
              <TextLines className="text-body" widths={['w-40']} />
            </div>
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
          <TextLines className="text-body leading-relaxed" widths={['w-full']} />
          <TextLines className="text-meta" widths={['w-16']} />
        </li>
      ))}
    </ul>
  );
}

async function SellerReviewsList({
  sellerId,
  displayName,
}: {
  sellerId: string;
  displayName: string;
}) {
  const reviews = await getReviewsFor(sellerId);
  return <ReviewList reviews={reviews} revieweeName={displayName} />;
}
