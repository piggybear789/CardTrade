// app/listings/[id]/page.tsx
//
// Item detail page (Req 3.8, 4.1, 5.1). A Server Component that loads a single
// Item via `getItem` (RLS returns it only when AVAILABLE or owned by the
// caller) and renders its full details: image gallery, title, description,
// category, condition, Fair_Market_Value (formatted from integer AUD cents),
// owner indication, and availability status.
//
// Transaction entry points are gated by the viewer's context:
//   * Owner            -> Edit / Delete links (to /listings/[id]/edit).
//   * Authenticated non-owner, item AVAILABLE -> trade, and Cash Sale controls
//     only when the Seller has a provider-approved identity disclosure.
//   * Unauthenticated  -> a prompt linking to sign-in.
// The buy/trade actions re-enforce these gates server-side; the gating here
// only decides what to surface.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pencil, LogIn, ArrowLeftRight, FileText } from 'lucide-react';

import { getItem } from '@/lib/actions/listings';
import { isWatching } from '@/lib/actions/watchlist';
import { createClient } from '@/lib/supabase/server';
import { loadSellerIdentityDisclosure } from '@/lib/sellerIdentity';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import { formatAud, itemImageUrl } from '@/lib/format';
import { BuyButton } from '@/components/listings/BuyButton';
import { WatchButton } from '@/components/listings/WatchButton';
import { MakeOfferDialog } from '@/components/offers/MakeOfferDialog';
import { MessageSellerButton } from '@/components/messages/MessageSellerButton';
import { ImageGallery, type GalleryImage } from '@/components/listings/ImageGallery';
import { DeleteListingDialog } from '@/components/listings/DeleteListingDialog';
import { ReportDialog } from '@/components/reports/ReportDialog';
import { StarRating } from '@/components/listings/StarRating';
import { VerifiedBadge } from '@/components/listings/VerifiedBadge';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// The page reads the signed-in user's cookies and reflects live availability,
// so it must render dynamically (never statically prerendered).
export const dynamic = 'force-dynamic';

type ItemStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD';

/** Map each availability status to a Badge variant + human-readable label. */
const STATUS_BADGE: Record<
  ItemStatus,
  { variant: NonNullable<BadgeProps['variant']>; label: string }
> = {
  AVAILABLE: { variant: 'default', label: 'Available' },
  RESERVED: { variant: 'secondary', label: 'Under Contract' },
  SOLD: { variant: 'outline', label: 'Sold' },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getItem(id);
  if (!result.ok) {
    return { title: 'Item not found · CardTrade' };
  }
  return {
    title: `${result.data.title} · CardTrade`,
    description: result.data.description.slice(0, 160),
  };
}

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const result = await getItem(id);
  // Not found, not visible under RLS, or a read failure — render the 404 state.
  if (!result.ok) {
    notFound();
  }
  const item = result.data;

  // Resolve the viewer context: who they are, whether they own this item, and
  // whether they are VERIFIED (drives which entry points are shown).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isOwner = user?.id === item.owner_id;
  // Authenticated non-owners can save the item to their watchlist.
  let initialWatching = false;
  if (user && !isOwner) {
    initialWatching = await isWatching(item.id);
  }

  // Seller's public info (catalog-safe view) for the listing's seller block.
  const { data: sellerRow } = await supabase
    .from('public_profiles')
    .select('display_name, rating, rating_count')
    .eq('id', item.owner_id)
    .maybeSingle();

  // Load only the narrow, buyer-safe merchant identity projection. The badge may
  // be shown publicly; full details cross the Server Component boundary only in
  // the authenticated buyer's confirmation controls.
  const sellerIdentity = await loadSellerIdentityDisclosure(item.owner_id);

  const status = (item.status as ItemStatus) ?? 'AVAILABLE';
  const statusBadge = STATUS_BADGE[status] ?? STATUS_BADGE.AVAILABLE;
  const isAvailable = status === 'AVAILABLE';

  // When the item is RESERVED and the viewer is the owner, resolve the active
  // contract (Cash_Sale or Trade) so we can link directly to the contract room.
  let activeSaleId: string | null = null;
  let activeTradeId: string | null = null;
  if (isOwner && status === 'RESERVED') {
    const [{ data: saleRow }, { data: tradeRow }] = await Promise.all([
      supabase
        .from('cash_sales')
        .select('id')
        .eq('item_id', item.id)
        .not('status', 'in', '("COMPLETED","CANCELLED","FAILED","REFUNDED")')
        .limit(1)
        .maybeSingle(),
      supabase
        .from('trades')
        .select('id')
        .or(`initiator_item_id.eq.${item.id},counterpart_item_id.eq.${item.id}`)
        .not('state', 'in', '("COMPLETED","FRAUD_RESOLVED")')
        .limit(1)
        .maybeSingle(),
    ]);
    activeSaleId = saleRow?.id ?? null;
    activeTradeId = tradeRow?.id ?? null;
  }

  const images: GalleryImage[] = (item.image_paths ?? [])
    .map((path) => itemImageUrl(path))
    .filter((src): src is string => Boolean(src))
    .map((src, index) => ({ src, alt: `${item.title} — image ${index + 1}` }));

  return (
    <MarketplaceShell title="Listing" contentWidth="detail">
      <nav className="mb-6" aria-label="Breadcrumb">
        <Link
          href="/listings"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Back to listings
        </Link>
      </nav>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-start">
        {/* Gallery */}
        <ImageGallery images={images} title={item.title} />

        {/* Details — flex column that stretches to match the gallery so
            secondary actions (save/report) stick to the bottom. */}
        <div className="flex min-h-full flex-col md:self-stretch">
          <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{item.title}</h1>
              <Badge
                variant={statusBadge.variant}
                aria-label={`Availability: ${statusBadge.label}`}
              >
                {statusBadge.label}
              </Badge>
            </div>

            <p className="text-3xl font-semibold tracking-tight">
              {formatAud(item.fmv_cents)}
            </p>

            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{item.category}</Badge>
              <Badge variant="outline">{item.condition}</Badge>
            </div>

            {/* Seller block */}
            <div className="rounded-lg border bg-card p-3">
              <div className="flex flex-col items-start gap-3 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Seller</p>
                  <div className="flex items-center gap-1.5">
                    {isOwner ? (
                      <p className="truncate text-sm font-medium">You</p>
                    ) : (
                      <Link
                        href={`/sellers/${item.owner_id}`}
                        className="truncate text-sm font-medium underline-offset-2 hover:underline"
                      >
                        {sellerRow?.display_name ?? 'Unknown seller'}
                      </Link>
                    )}
                    {sellerIdentity && <VerifiedBadge size={15} />}
                  </div>
                </div>
                <StarRating
                  rating={sellerRow?.rating ?? null}
                  count={sellerRow?.rating_count ?? undefined}
                />
              </div>

              {/* Inline identity disclosure — visible to buyers so they know
                  who they're transacting with (Req 4.8). */}
              {sellerIdentity && !isOwner && (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Legal entity</dt>
                    <dd className="font-medium">{sellerIdentity.legalEntityName}</dd>
                  </div>
                  {sellerIdentity.tradingName && (
                    <div>
                      <dt className="text-muted-foreground">Trading as</dt>
                      <dd className="font-medium">{sellerIdentity.tradingName}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-muted-foreground">Registration</dt>
                    <dd className="font-medium">{sellerIdentity.registrationNumber}</dd>
                  </div>
                  {sellerIdentity.organisationType && (
                    <div>
                      <dt className="text-muted-foreground">Type</dt>
                      <dd className="font-medium">{sellerIdentity.organisationType}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          </div>

          <section aria-labelledby="description-heading" className="space-y-2">
            <h2 id="description-heading" className="text-sm font-medium">
              Description
            </h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
              {item.description}
            </p>
          </section>

          {/* Transaction entry points, gated by viewer context. */}
          <ItemActions
            itemId={item.id}
            itemTitle={item.title}
            sellerId={item.owner_id}
            fmvCents={item.fmv_cents}
            isOwner={isOwner}
            isAuthenticated={Boolean(user)}
            isAvailable={isAvailable}
            sellerIdentity={sellerIdentity}
            activeSaleId={activeSaleId}
            activeTradeId={activeTradeId}
          />
          </div>

          {/* Message seller — pushed to bottom of details rail, just above
              the save/report divider. */}
          {user && !isOwner && isAvailable && (
            <div className="mt-auto">
              <MessageSellerButton
                itemId={item.id}
                sellerId={item.owner_id}
                variant="inline"
              />
            </div>
          )}

          {/* Secondary, lower-emphasis actions — save + report. */}
          {user && !isOwner && (
            <div className="flex items-center justify-between gap-3 pt-4">
              <WatchButton
                itemId={item.id}
                initialWatching={initialWatching}
                className="w-auto"
              />
              <ReportDialog
                targetType="item"
                targetId={item.id}
                triggerLabel="Report listing"
              />
            </div>
          )}
        </div>
      </div>
    </MarketplaceShell>
  );
}

/**
 * Renders the appropriate entry points for the current viewer:
 *   * owner -> Edit / Delete;
 *   * authenticated non-owner + available -> trade, plus Buy/Offer only when
 *     the seller has an approved identity disclosure (Req 4.8-4.13);
 *   * authenticated but unverified -> verification prompt;
 *   * unauthenticated -> sign-in prompt;
 *   * unavailable (for non-owners) -> a simple unavailable notice.
 */
function ItemActions({
  itemId,
  itemTitle,
  sellerId,
  fmvCents,
  isOwner,
  isAuthenticated,
  isAvailable,
  sellerIdentity,
  activeSaleId,
  activeTradeId,
}: {
  itemId: string;
  itemTitle: string;
  sellerId: string;
  fmvCents: number;
  isOwner: boolean;
  isAuthenticated: boolean;
  isAvailable: boolean;
  sellerIdentity: SellerIdentityDisclosure | null;
  activeSaleId: string | null;
  activeTradeId: string | null;
}) {
  // Owner controls: when the item is under contract, surface the active
  // contract link prominently instead of edit/delete (which aren't allowed on
  // RESERVED items anyway per Req 3.5).
  if (isOwner) {
    const hasContract = Boolean(activeSaleId || activeTradeId);
    if (hasContract) {
      const contractHref = activeSaleId
        ? `/sales/${activeSaleId}`
        : `/trades/${activeTradeId}`;
      const contractLabel = activeSaleId ? 'Open sale contract' : 'Open trade contract';
      return (
        <div className="space-y-3">
          <Card className="border-gold/40 bg-gold/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Under contract</CardTitle>
              <CardDescription>
                This item is currently in an active contract. Manage it from the
                contract room.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full sm:w-auto">
                <Link href={contractHref}>
                  <FileText aria-hidden />
                  {contractLabel}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href={`/listings/${itemId}/edit`}>
            <Pencil aria-hidden />
            Edit listing
          </Link>
        </Button>
        <DeleteListingDialog itemId={itemId} itemTitle={itemTitle} />
      </div>
    );
  }

  // Non-owner: the item must be AVAILABLE to buy or trade.
  if (!isAvailable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Not available</CardTitle>
          <CardDescription>
            This item is not currently available for purchase or trade.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Unauthenticated visitors are prompted to sign in first (Req 1.7).
  if (!isAuthenticated) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sign in to continue</CardTitle>
          <CardDescription>
            Sign in to buy this item or propose a trade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full sm:w-auto">
            <Link href={`/sign-in?redirectTo=/listings/${itemId}`}>
              <LogIn aria-hidden />
              Sign in
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Cash buyers need a payment method, not merchant/KYC onboarding. Buying for
  // cash needs the seller to have somewhere to be paid into and an identity the
  // buyer can inspect first (Req 4.8). Trading needs neither, because no cash
  // moves — so a seller without a payout account is trade-only, not unavailable.
  //
  // Visual hierarchy: Buy / Trade / Offer sit in one inline row as the
  // transactional actions. "Message seller" lives below as a separate section
  // with its own input affordance, matching the reference inline-message pattern.
  return (
    <div className="space-y-5">
      {!sellerIdentity ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open to trades only</CardTitle>
            <CardDescription>
              This seller cannot take cash payments yet. You can still offer a
              swap, or message them.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {/* Primary transaction row — Buy / Trade / Offer inline. */}
      <div className="flex flex-wrap items-center gap-2">
        {sellerIdentity ? (
          <BuyButton itemId={itemId} sellerIdentity={sellerIdentity} />
        ) : null}
        <Button asChild variant="outline" size="lg" className="flex-1 sm:flex-none">
          <Link href={`/trades/new?counterpartItemId=${itemId}`}>
            <ArrowLeftRight aria-hidden />
            Propose trade
          </Link>
        </Button>
        {sellerIdentity ? (
          <MakeOfferDialog
            itemId={itemId}
            fmvCents={fmvCents}
            sellerIdentity={sellerIdentity}
            size="lg"
          />
        ) : null}
      </div>
    </div>
  );
}
