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

import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, LogIn, ArrowLeftRight, FileText, Heart } from "lucide-react";

import { getItem } from "@/lib/actions/listings";
import { getWatchCount, isWatching } from "@/lib/actions/watchlist";
import { createClient } from "@/lib/supabase/server";
import { loadSellerIdentityDisclosure } from "@/lib/sellerIdentity";
import type { SellerIdentityDisclosure } from "@/domain/orchestrator/merchantOnboarding";
import {
  formatAud,
  formatRegistrationNumber,
  itemImageUrl,
} from "@/lib/format";
import { BuyButton } from "@/components/listings/BuyButton";
import { WatchButton } from "@/components/listings/WatchButton";
import { MakeOfferDialog } from "@/components/offers/MakeOfferDialog";
import { MessageSellerButton } from "@/components/messages/MessageSellerButton";
import {
  ImageGallery,
  type GalleryImage,
} from "@/components/listings/ImageGallery";
import { CopyTradeLink } from "@/components/listings/CopyTradeLink";
import { DeleteListingDialog } from "@/components/listings/DeleteListingDialog";
import { ReportDialog } from "@/components/reports/ReportDialog";
import { StarRating } from "@/components/listings/StarRating";
import { VerifiedBadge } from "@/components/listings/VerifiedBadge";
import { MarketplaceShell } from "@/components/layout/MarketplaceShell";
import { PlaceMap } from "@/components/location";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// The page reads the signed-in user's cookies and reflects live availability,
// so it must render dynamically (never statically prerendered).
export const dynamic = "force-dynamic";

type ItemStatus = "AVAILABLE" | "RESERVED" | "SOLD";

/** Map each availability status to a Badge variant + human-readable label. */
const STATUS_BADGE: Record<
  ItemStatus,
  { variant: NonNullable<BadgeProps["variant"]>; label: string }
> = {
  AVAILABLE: { variant: "default", label: "Available" },
  RESERVED: { variant: "secondary", label: "Under Contract" },
  SOLD: { variant: "outline", label: "Sold" },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getItem(id);
  if (!result.ok) {
    return { title: "Item not found · Poke-xchange" };
  }
  return {
    title: `${result.data.title} · Poke-xchange`,
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
  // Authenticated non-owners can save the item to their watchlist. The save
  // count is public social proof, shown to every viewer.
  let initialWatching = false;
  if (user && !isOwner) {
    initialWatching = await isWatching(item.id);
  }
  const watchCount = await getWatchCount(item.id);

  // Seller's public info (catalog-safe view) for the listing's seller block.
  const { data: sellerRow } = await supabase
    .from("public_profiles")
    .select("display_name, rating, rating_count")
    .eq("id", item.owner_id)
    .maybeSingle();

  // Load only the narrow, buyer-safe merchant identity projection. The badge may
  // be shown publicly; full details cross the Server Component boundary only in
  // the authenticated buyer's confirmation controls.
  const sellerIdentity = await loadSellerIdentityDisclosure(item.owner_id);

  const status = (item.status as ItemStatus) ?? "AVAILABLE";
  const statusBadge = STATUS_BADGE[status] ?? STATUS_BADGE.AVAILABLE;
  const isAvailable = status === "AVAILABLE";

  // When the item is RESERVED and the viewer is the owner, resolve the active
  // contract (Cash_Sale or Trade) so we can link directly to the contract room.
  let activeSaleId: string | null = null;
  let activeTradeId: string | null = null;
  if (isOwner && status === "RESERVED") {
    const [{ data: saleRow }, { data: tradeRow }] = await Promise.all([
      supabase
        .from("cash_sales")
        .select("id")
        .eq("item_id", item.id)
        .not("status", "in", '("COMPLETED","CANCELLED","FAILED","REFUNDED")')
        .limit(1)
        .maybeSingle(),
      supabase
        .from("trades")
        .select("id")
        .or(`initiator_item_id.eq.${item.id},counterpart_item_id.eq.${item.id}`)
        .not("state", "in", '("COMPLETED","FRAUD_RESOLVED")')
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
    <MarketplaceShell
      title={item.title.length > 40 ? `${item.title.slice(0, 37)}…` : item.title}
    >
      {/* Split view (lg+), Facebook-Marketplace style: this wrapper is
          exactly the height of the workspace content box — 100dvh less the
          header (h-16 + 1px border + safe-area) and the section's lg:py-7 —
          all hard chrome values, no text metrics. The breadcrumb then takes
          its natural height inside and the split row gets the rest via
          flex-1, so nothing here depends on estimating line heights: the
          page itself never scrolls, the gallery pane stays put, and the
          details pane scrolls internally (`overflow-y-auto`).

          The height can't come from the flex ancestors alone: body is
          min-h-dvh, a floor rather than a cap, so a too-tall flex-1 chain
          just grows the page instead of being clipped. The bound has to be
          declared somewhere, and this wrapper is the one place where it's
          composed purely of fixed paddings. Below lg the wrapper is
          auto-height, the columns stack, and the page scrolls normally. */}
      <div className="flex min-h-0 flex-col lg:h-[calc(100dvh-7.5rem-1px-env(safe-area-inset-top))]">
        <nav className="mb-6" aria-label="Breadcrumb">
          <Link
            href="/listings"
            className="rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            ← Back to listings
          </Link>
        </nav>

        {/* The column switch and the bounded height MUST share the same
          breakpoint: if the columns could sit side by side without the
          height cap, the page would scroll and the gallery would drift out
          of view. `lg` is safe because the rail geometry guarantees the
          content box is at least ~47rem there — enough for both columns plus
          the gap. */}
        <div className="flex min-h-0 flex-col items-stretch gap-8 lg:flex-1 lg:flex-row">
          {/* Gallery — the frame caps itself below the row height (breathing
            room), so centre it vertically rather than leaving it pinned to
            the top of the pane. */}
          <div className="min-w-0 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
            <ImageGallery images={images} title={item.title} />
          </div>

          {/* Details — its own scroll container while the split row has a fixed
            height; stretches to match the gallery so secondary actions
            (save/report) stick to the bottom when content is short. The
            scrollbar itself is hidden (same treatment as the workspace rail):
            it rendered as a visible gutter splitting the two panes. Wheel,
            drag, and keyboard scrolling all still work. */}
          <div className="flex min-w-0 flex-col overscroll-contain lg:flex-1 lg:overflow-y-auto lg:[-ms-overflow-style:none] lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="min-w-0 break-words text-3xl font-semibold tracking-[-0.025em]">
                    {item.title}
                  </h2>
                  <Badge
                    variant={statusBadge.variant}
                    aria-label={`Availability: ${statusBadge.label}`}
                  >
                    {statusBadge.label}
                  </Badge>
                </div>

                <p className="text-3xl font-semibold tabular-nums tracking-tight">
                  {formatAud(item.fmv_cents)}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{item.category}</Badge>
                  <Badge variant="outline">{item.condition}</Badge>
                  {watchCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-sm tabular-nums text-muted-foreground">
                      <Heart
                        className="size-4 fill-destructive text-destructive"
                        aria-hidden="true"
                      />
                      {watchCount} {watchCount === 1 ? "save" : "saves"}
                    </span>
                  ) : null}
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
                            {sellerRow?.display_name ?? "Unknown seller"}
                          </Link>
                        )}
                        {sellerIdentity && <VerifiedBadge size={15} />}
                      </div>
                    </div>
                    {isOwner ? (
                      <StarRating
                        rating={sellerRow?.rating ?? null}
                        count={sellerRow?.rating_count ?? undefined}
                      />
                    ) : (
                      <Link
                        href={`/sellers/${item.owner_id}#reviews`}
                        className="rounded-sm transition-colors hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Read seller reviews"
                      >
                        <StarRating
                          rating={sellerRow?.rating ?? null}
                          count={sellerRow?.rating_count ?? undefined}
                        />
                      </Link>
                    )}
                  </div>

                  {/* Inline identity disclosure — visible to buyers so they know
                  who they're transacting with (Req 4.8). */}
                  {sellerIdentity && !isOwner && (
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 text-xs">
                      <div className="min-w-0">
                        <dt className="text-muted-foreground">Legal entity</dt>
                        <dd className="break-words font-medium">
                          {sellerIdentity.legalEntityName}
                        </dd>
                      </div>
                      {sellerIdentity.tradingName && (
                        <div className="min-w-0">
                          <dt className="text-muted-foreground">Trading as</dt>
                          <dd className="break-words font-medium">
                            {sellerIdentity.tradingName}
                          </dd>
                        </div>
                      )}
                      <div className="min-w-0">
                        <dt className="text-muted-foreground">Registration</dt>
                        <dd className="break-words font-medium">
                          {formatRegistrationNumber(
                            sellerIdentity.registrationNumber,
                          )}
                        </dd>
                      </div>
                      {sellerIdentity.organisationType && (
                        <div className="min-w-0">
                          <dt className="text-muted-foreground">Type</dt>
                          <dd className="break-words font-medium">
                            {sellerIdentity.organisationType}
                          </dd>
                        </div>
                      )}
                    </dl>
                  )}
                </div>
              </div>

              <section
                aria-labelledby="description-heading"
                className="space-y-2"
              >
                <h2 id="description-heading" className="text-sm font-medium">
                  Description
                </h2>
                <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground">
                  {item.description}
                </p>
              </section>

              {item.location_label ||
              (item.location_lat != null && item.location_lng != null) ? (
                <section
                  aria-labelledby="location-heading"
                  className="space-y-2"
                >
                  <h2 id="location-heading" className="text-sm font-medium">
                    Based near
                  </h2>
                  <PlaceMap
                    lat={item.location_lat}
                    lng={item.location_lng}
                    label={item.location_label}
                    heightClassName="h-40"
                  />
                </section>
              ) : null}

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
            {/* `mt-auto` pushes this down when the column has slack, but collapses
              to zero once the content fills it — `pt-6` guarantees breathing
              room above regardless of how tight the column gets. */}
            {user && !isOwner && isAvailable && (
              <div className="mt-auto pt-6">
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
      const contractLabel = activeSaleId ? "Open Sale" : "Open Trade";
      return (
        <div className="space-y-3 rounded-lg border border-gold/40 bg-gold/5 p-4">
          <div>
            <p className="text-base font-semibold">Under Contract</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This item is in an active {activeSaleId ? "sale" : "trade"}. Manage
              it from the contract room.
            </p>
          </div>
          <Button asChild className="w-full sm:w-auto">
            <Link href={contractHref}>
              <FileText aria-hidden />
              {contractLabel}
            </Link>
          </Button>
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
        <CopyTradeLink itemId={itemId} />
        <DeleteListingDialog itemId={itemId} itemTitle={itemTitle} />
      </div>
    );
  }

  // Non-owner: the item must be AVAILABLE to buy or trade.
  if (!isAvailable) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-5">
        <p className="text-base font-semibold">Not Available</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This item is not currently available for purchase or trade.
        </p>
      </div>
    );
  }

  // Unauthenticated visitors are prompted to sign in first (Req 1.7).
  if (!isAuthenticated) {
    return (
      <div className="space-y-3 rounded-lg border border-dashed px-4 py-5">
        <div>
          <p className="text-base font-semibold">Sign In to Continue</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to buy this item or propose a trade.
          </p>
        </div>
        <Button asChild className="w-full sm:w-auto">
          <Link href={`/sign-in?redirectTo=/listings/${itemId}`}>
            <LogIn aria-hidden />
            Sign In
          </Link>
        </Button>
      </div>
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
        <div className="space-y-3 rounded-lg border border-dashed px-4 py-4">
          <div>
            <p className="text-base font-semibold">Open to Trades Only</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This seller cannot take cash payments yet. You can still propose a
              trade, or message them.
            </p>
          </div>
          <Button asChild className="w-full sm:w-auto">
            <Link href={`/trades/new?counterpartItemId=${itemId}`}>
              <ArrowLeftRight aria-hidden />
              Propose Trade
            </Link>
          </Button>
        </div>
      ) : null}

      {/* Primary transaction row — Buy / Trade / Offer inline. Each action
          grows from a shared basis so they wrap in balanced rows instead of
          leaving one button stranded on a line of its own. */}
      <div className="flex flex-wrap items-center gap-2 [&>*]:flex-1 [&>*]:basis-[9.5rem]">
        {sellerIdentity ? (
          <BuyButton itemId={itemId} sellerIdentity={sellerIdentity} />
        ) : null}
        {sellerIdentity ? (
          <Button asChild variant="outline" size="lg">
            <Link href={`/trades/new?counterpartItemId=${itemId}`}>
              <ArrowLeftRight aria-hidden />
              Propose Trade
            </Link>
          </Button>
        ) : null}
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
