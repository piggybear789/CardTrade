//
// Public seller profile (Phase 5). A dynamic Server Component that shows a
// seller's public identity (display name, aggregate rating, Verified badge),
// their listings, and the reviews other traders have left about them.
//
// All seller fields come from the catalog-safe `public_profiles` view (never
// contact email / raw KYC status). Listings are read from `items` (RLS exposes
// AVAILABLE and SOLD rows publicly since 0108). Reviews come from `getReviewsFor`
// (public select).
//
// THE PAGE IS THREE STACKED BANDS, NOT A SPLIT. Header, then the trust band, then a
// tab strip over the panels. An earlier design put trust facts in a left rail beside
// the listings grid; the rails could not agree on height, so the grid started at a
// different y depending on whether the seller had a trading name. See the note in
// `SellerTrustBand`.

import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

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
import { SellerTrustBand } from '@/components/profile/SellerTrustBand';
import { TabbedPanels, type TabDescriptor } from '@/components/ui/tabbed-panels';
import type {
  CatalogItem,
  CatalogSeller,
  ItemRow,
} from '@/lib/actions/listings';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

/**
 * A seller's sold history is shown for price reference, so it is capped rather than
 * paginated: past this many rows the tab stops being a signal and starts being an
 * archive, which is not what a buyer opened it for.
 */
const SOLD_LIMIT = 24;

type SellerTabId = 'listings' | 'sold' | 'reviews';

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [{ id }, { tab: rawTab }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  // Public, catalog-safe seller identity.
  const { data: sellerRow } = await supabase
    .from('public_profiles')
    .select(
      'id, display_name, rating, rating_count, is_verified, identity_first_name, avatar_path, social_links, bio, region_code',
    )
    .eq('id', id)
    .maybeSingle();

  if (!sellerRow) {
    notFound();
  }

  // FIVE INDEPENDENT READS, ONE ROUND TRIP. Each of these needs only `id` (or
  // nothing at all), so writing them as five statements would cost four round trips of
  // pure latency in front of a public, shareable page. Only the `notFound` guard
  // above genuinely has to happen first.
  const [
    user,
    sellerIdentity,
    { data: itemsData, error: itemsError },
    { data: soldData },
    saleStats,
  ] = await Promise.all([
    // Resolve the viewer so we can offer a report affordance when an
    // authenticated user is viewing *someone else's* profile (never their own),
    // and so the tiles can carry a watch control.
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
    // Sell-through history. A SEPARATE query rather than `.in('status', [...])` on the
    // one above: a single query would have to be capped in total, and a seller with a
    // long back catalogue would then have their sold rows crowd out the listings
    // anyone actually came to buy.
    //
    // `status = 'SOLD'` is publicly readable from 0108, which also records why: it is
    // a price comparable, and it is the same sell-through history any marketplace
    // carries. Note a SHOPFRONT never reaches SOLD (0064), so nothing here is a binder.
    supabase
      .from('items')
      .select('*')
      .eq('owner_id', id)
      .eq('status', 'SOLD')
      .is('closed_at', null)
      .eq('hidden', false)
      .in('category', CARD_GAME_NAMES)
      .order('created_at', { ascending: false })
      .limit(SOLD_LIMIT),
    // Aggregate-only reputation counts (0010). EXECUTE is granted to `authenticated`
    // alone, so this fails for a signed-out visitor by design — the error is read as
    // "not disclosed to you" and the figure is omitted, never rendered as zero.
    supabase.rpc('member_sale_stats', { p_profile_id: id }),
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
  const soldItems = (soldData ?? []) as ItemRow[];
  const withSeller = (row: ItemRow): CatalogItem => ({ ...row, seller });
  const catalogItems = items.map(withSeller);
  const catalogSoldItems = soldItems.map(withSeller);

  // NULL IS NOT ZERO. `member_sale_stats` is security-definer and member-executable,
  // so an authenticated viewer gets a real count; a guest gets a permission error and
  // no figure at all. Collapsing the two would tell a signed-out buyer that an
  // established seller has never completed a sale.
  const statsRow = Array.isArray(saleStats.data) ? saleStats.data[0] : saleStats.data;
  const completedSales = saleStats.error
    ? null
    : ((statsRow as { completed_sales: number | null } | null | undefined)
        ?.completed_sales ?? 0);

  // WATCH STATE NEEDS THE VIEWER, so it cannot join the batch above. This mirrors
  // `fetchCatalogPage`, which resolves its page and then asks one question about it.
  // Only the available tiles get a control: a heart on a sold card would save
  // something that can never come back.
  let watchingIds = new Set<string>();
  if (user && catalogItems.length > 0) {
    const { data: watchRows } = await supabase
      .from('watchlist')
      .select('item_id')
      .eq('user_id', user.id)
      .in(
        'item_id',
        catalogItems.map((item) => item.id),
      );
    watchingIds = new Set((watchRows ?? []).map((row) => row.item_id as string));
  }

  const displayName = seller.displayName ?? 'Unknown seller';

  // A tab is only offered when it has something behind it. An empty "Sold" tab on a
  // new seller's profile is not neutral — it reads as a record of having sold nothing.
  const tabs: TabDescriptor<SellerTabId>[] = [
    { id: 'listings', label: 'Listings', href: `/sellers/${id}`, count: items.length || undefined },
    ...(soldItems.length > 0
      ? [
          {
            id: 'sold' as const,
            label: 'Sold',
            href: `/sellers/${id}?tab=sold`,
            count: soldItems.length,
          },
        ]
      : []),
    {
      id: 'reviews',
      label: 'Reviews',
      href: `/sellers/${id}?tab=reviews`,
      count: seller.ratingCount || undefined,
    },
  ];

  // Resolved HERE rather than in the strip so the server's first paint already shows
  // the right panel. A `?tab=` naming a tab this seller does not have falls back to
  // the first, which is also what the strip does when answering Back.
  const rawTabValue = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const initialTab: SellerTabId =
    tabs.find((entry) => entry.id === rawTabValue)?.id ?? 'listings';

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
                is what lets the reviews themselves stream in below.

                THE LINK IS A TAB, NOT AN ANCHOR. It used to be `#reviews`, which
                worked while every section was on the page at once; the reviews now
                live in a panel, and an in-page hash cannot open one. */}
            {seller.ratingCount > 0 ? (
              <Link
                href={`/sellers/${id}?tab=reviews`}
                className="w-fit rounded-sm border border-transparent transition-colors hover:opacity-80 focus:outline-none focus-visible:border-iris"
                aria-label={`Read ${seller.ratingCount} reviews`}
              >
                <StarRating rating={seller.rating} count={seller.ratingCount} size={16} />
              </Link>
            ) : (
              <StarRating rating={seller.rating} count={seller.ratingCount} size={16} />
            )}
            <SocialLinksDisplay socialLinks={sellerRow.social_links as Record<string, string> | null} />
            {/* MEMBER-AUTHORED, so it is presented as their words and nothing more.
                Deliberately NOT inside the trust band below, which carries
                provider-verified facts — putting self-written copy there
                would borrow that band's credibility for text anyone can type.
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

        <SellerTrustBand
          legalName={sellerIdentity?.legalEntityName ?? null}
          tradingName={sellerIdentity?.tradingName ?? null}
          verifiedAt={sellerIdentity?.verifiedAt ?? null}
          regionCode={(sellerRow.region_code as string | null) ?? null}
          completedSales={completedSales}
        />
      </header>

      {/* ONE STRIP, THREE PANELS, ALL SERVER-RENDERED ONCE. Switching is local state,
          so a buyer comparing a seller's stock against their reviews does not pay a
          round trip each way. The panels were stacked sections before, which meant
          the reviews sat under however many tiles the seller happened to have. */}
      <TabbedPanels
        tabs={tabs}
        initialTab={initialTab}
        label="Seller sections"
        layoutId="seller-tabs"
        panels={{
          listings: (
            <section aria-labelledby="listings-heading">
              {/* The strip names this panel visually, so the heading is for the
                  document outline and for anyone navigating by heading — these are
                  URL tabs rather than an ARIA tabs widget, so there is no
                  `tabpanel`/`aria-labelledby` pairing doing the job instead. */}
              <h3 id="listings-heading" className="sr-only">
                Available listings
              </h3>
              {itemsError ? (
                <SectionLoadError label="listings" />
              ) : catalogItems.length === 0 ? (
                <EmptyState
                  title="No Available Listings"
                  titleAs="h4"
                  description="This seller has no available listings right now."
                  compact
                />
              ) : (
                <div className={CATALOG_TILE_GRID}>
                  {catalogItems.map((item) => (
                    <CatalogItemCard
                      key={item.id}
                      item={item}
                      // `undefined` hides the control entirely, which is what a guest
                      // and the seller themselves should both get: one cannot save,
                      // the other would be saving their own card.
                      initialWatching={
                        user && item.owner_id !== user.id
                          ? watchingIds.has(item.id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          ),
          sold: (
            <section aria-labelledby="sold-heading">
              <h3 id="sold-heading" className="sr-only">
                Recently sold
              </h3>
              {/* ONE line of context, because a sold card in a grid otherwise reads as
                  something to buy. The tiles badge themselves too, but the reason the
                  tab exists — a price the seller actually achieved — is worth saying
                  once. No watch control: nothing here can come back. */}
              <p className="mb-group text-meta text-muted-foreground">
                What this seller has already sold, newest first. Prices shown are what
                each card was listed at.
              </p>
              <div className={CATALOG_TILE_GRID}>
                {catalogSoldItems.map((item) => (
                  <CatalogItemCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          ),
          reviews: (
            // ONLY THE LIST STREAMS. `getReviewsFor` is a two-stage fetch and awaiting
            // it inline made the seller's name, badge and entire listings grid wait on
            // one panel.
            //
            // THE SECTION AND ITS HEADING STAY OUTSIDE THE BOUNDARY, and that is not
            // cosmetic: a first cut put them inside both the fallback and the resolved
            // child, so `id="reviews-heading"` existed twice while the stream was in
            // flight. Duplicate ids are invalid and they make `aria-labelledby`
            // ambiguous. Rendering the frame once and suspending only its contents
            // avoids both. The count comes from the profile row's aggregate, so the
            // tab's own label needs no await.
            <section id="reviews" aria-labelledby="reviews-heading">
              <h3 id="reviews-heading" className="sr-only">
                Reviews of {displayName}
              </h3>
              <Suspense fallback={<SellerReviewsFallback />}>
                <SellerReviewsList sellerId={id} displayName={displayName} />
              </Suspense>
            </section>
          ),
        }}
      />
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
