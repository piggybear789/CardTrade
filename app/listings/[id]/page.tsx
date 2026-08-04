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
import {
  ArrowLeft,
  FileText,
  Heart,
  LogIn,
  Pencil,
} from "lucide-react";

import { getItem, type ItemRow } from "@/lib/actions/listings";
import { getWatchCount, isWatching } from "@/lib/actions/watchlist";
import { createClient } from "@/lib/supabase/server";
import { identityGateMessage, readIdentityGate } from "@/lib/identityGate";
import { loadSellerIdentityDisclosure } from "@/lib/sellerIdentity";
import type { SellerIdentityDisclosure } from "@/domain/orchestrator/merchantOnboarding";
import {
  formatAud,
  itemImageUrl,
} from "@/lib/format";
import { BuyButton } from "@/components/listings/BuyButton";
import { WatchButton } from "@/components/listings/WatchButton";
import { MakeOfferDialog } from "@/components/offers/MakeOfferDialog";
import { ProposeTradeDialog } from "@/components/trade/ProposeTradeDialog";
import { MessageSellerButton } from "@/components/messages/MessageSellerButton";
import {
  ImageGallery,
  type GalleryImage,
} from "@/components/listings/ImageGallery";
import { CopyTradeLink } from "@/components/listings/CopyTradeLink";
import { DeleteListingDialog } from "@/components/listings/DeleteListingDialog";
import { ReportDialog } from "@/components/reports/ReportDialog";
import { StarRating } from "@/components/listings/StarRating";
import { IdentityBadge } from "@/components/identity/IdentityBadge";
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
    return { title: "Item not found · NoDitto" };
  }
  return {
    title: `${result.data.title} · NoDitto`,
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
  const status = (item.status as ItemStatus) ?? "AVAILABLE";
  const statusBadge = STATUS_BADGE[status] ?? STATUS_BADGE.AVAILABLE;
  const isAvailable = status === "AVAILABLE";

  // Authenticated non-owners: watch state, own goods for Propose Trade, and
  // public seller profile + identity can load together.
  const canProposeTrade = Boolean(user && !isOwner && isAvailable);

  const [
    initialWatching,
    watchCount,
    sellerRowResult,
    sellerIdentity,
    ownItemsResult,
    viewerTradeGate,
  ] = await Promise.all([
    user && !isOwner ? isWatching(item.id) : Promise.resolve(false),
    getWatchCount(item.id),
    supabase
      .from("public_profiles")
      .select(
        "display_name, rating, rating_count, is_verified, identity_first_name",
      )
      .eq("id", item.owner_id)
      .maybeSingle(),
    loadSellerIdentityDisclosure(item.owner_id),
    canProposeTrade
      ? supabase
          .from("items")
          .select("*")
          .eq("owner_id", user!.id)
          .eq("status", "AVAILABLE")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as ItemRow[] }),
    canProposeTrade ? readIdentityGate(user!.id) : Promise.resolve(null),
  ]);

  const sellerRow = sellerRowResult.data;
  const ownItems = (ownItemsResult.data ?? []) as ItemRow[];
  const canStartTrade = Boolean(viewerTradeGate?.satisfied);
  const tradeGateMessage =
    viewerTradeGate && !viewerTradeGate.satisfied
      ? identityGateMessage('trade', viewerTradeGate.state)
      : null;
  const sellerDisplayName =
    (sellerRow?.display_name as string | null)?.trim() || "The other trader";

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
        <nav className="mb-4 sm:mb-6" aria-label="Breadcrumb">
          <Button asChild variant="outline" size="sm">
            <Link href="/listings">
              <ArrowLeft aria-hidden="true" />
              Back to listings
            </Link>
          </Button>
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
                  <h2 className="min-w-0 break-words text-xl font-semibold tracking-[-0.025em] sm:text-2xl lg:text-3xl">
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

                {/* Seller block — compact: name + trust + rating on one row,
                    identity as dense label/value lines. */}
                <div className="rounded-lg border bg-card px-3 py-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="sr-only">Seller</span>
                    <div className="flex min-w-0 items-center gap-1">
                      {isOwner ? (
                        <p className="truncate text-sm font-semibold">You</p>
                      ) : (
                        <Link
                          href={`/sellers/${item.owner_id}`}
                          className="truncate text-sm font-semibold underline-offset-2 hover:underline"
                        >
                          {sellerRow?.display_name ?? "Unknown seller"}
                        </Link>
                      )}
                      {/* ONE mark. A <VerifiedBadge/> used to sit here too, gated on
                          `sellerIdentity`, which requires APPROVED + settlements —
                          the same Identity_Gate `is_verified` reports. Two glyphs,
                          one fact. */}
                      <IdentityBadge
                        verified={Boolean(sellerRow?.is_verified)}
                        firstName={
                          (sellerRow?.identity_first_name as string | null) ?? null
                        }
                        size={14}
                        iconOnly
                        className="shrink-0"
                      />
                    </div>
                    {isOwner ? (
                      <StarRating
                        rating={sellerRow?.rating ?? null}
                        count={sellerRow?.rating_count ?? undefined}
                        size={12}
                        className="text-[0.6875rem]"
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
                          size={12}
                          className="text-[0.6875rem]"
                        />
                      </Link>
                    )}
                  </div>

                  {/* Inline identity disclosure — visible to buyers so they know
                  who they're transacting with (Req 4.8). */}
                  {sellerIdentity && !isOwner ? (
                    <dl className="mt-1.5 space-y-0.5 border-t border-border/70 pt-1.5 text-[0.6875rem] leading-snug">
                      <div className="flex min-w-0 gap-1.5">
                        <dt className="shrink-0 text-muted-foreground">Legal</dt>
                        <dd className="min-w-0 break-words font-medium">
                          {sellerIdentity.legalEntityName}
                        </dd>
                      </div>
                      {sellerIdentity.tradingName ? (
                        <div className="flex min-w-0 gap-1.5">
                          <dt className="shrink-0 text-muted-foreground">
                            Trading as
                          </dt>
                          <dd className="min-w-0 break-words font-medium">
                            {sellerIdentity.tradingName}
                          </dd>
                        </div>
                      ) : null}
                      <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
                        {sellerIdentity.organisationType ? (
                          <div className="flex min-w-0 gap-1.5">
                            <dt className="shrink-0 text-muted-foreground">
                              Type
                            </dt>
                            <dd className="min-w-0 break-words font-medium">
                              {sellerIdentity.organisationType}
                            </dd>
                          </div>
                        ) : null}
                      </div>
                    </dl>
                  ) : null}
                </div>
              </div>

              {/* Transaction entry points sit above the description so Buy /
                  Trade / Offer / Save / Report are reachable without scrolling. */}
              <ItemActions
                itemId={item.id}
                itemTitle={item.title}
                itemImagePath={(item.image_paths ?? [])[0] ?? null}
                sellerId={item.owner_id}
                sellerDisplayName={sellerDisplayName}
                fmvCents={item.fmv_cents}
                isOwner={isOwner}
                isAuthenticated={Boolean(user)}
                isAvailable={isAvailable}
                canStartTrade={canStartTrade}
                tradeGateMessage={tradeGateMessage}
                sellerIdentity={sellerIdentity}
                activeSaleId={activeSaleId}
                activeTradeId={activeTradeId}
                initialWatching={initialWatching}
                ownItems={ownItems}
              />

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
  itemImagePath,
  sellerDisplayName,
  fmvCents,
  isOwner,
  isAuthenticated,
  isAvailable,
  canStartTrade,
  tradeGateMessage,
  sellerIdentity,
  activeSaleId,
  activeTradeId,
  initialWatching,
  ownItems,
}: {
  itemId: string;
  itemTitle: string;
  itemImagePath: string | null;
  sellerId: string;
  sellerDisplayName: string;
  fmvCents: number;
  isOwner: boolean;
  isAuthenticated: boolean;
  isAvailable: boolean;
  canStartTrade: boolean;
  tradeGateMessage: string | null;
  sellerIdentity: SellerIdentityDisclosure | null;
  activeSaleId: string | null;
  activeTradeId: string | null;
  initialWatching: boolean;
  ownItems: ItemRow[];
}) {
  const watchReport =
    isAuthenticated && !isOwner ? (
      <>
        <WatchButton
          itemId={itemId}
          initialWatching={initialWatching}
          variant="action"
        />
        <ReportDialog
          targetType="item"
          targetId={itemId}
          triggerLabel="Report listing"
          appearance="icon"
        />
      </>
    ) : null;

  const canOpenTrade = canStartTrade && Boolean(sellerIdentity);
  const disabledTradeReason = !canStartTrade
    ? tradeGateMessage
    : !sellerIdentity
      ? 'This seller must finish payout setup before a trade can start.'
      : null;

  const proposeTrade =
    isAuthenticated && !isOwner && isAvailable ? (
      <ProposeTradeDialog
        requested={{
          id: itemId,
          title: itemTitle,
          fmvCents,
          imagePath: itemImagePath,
          ownerName: sellerDisplayName,
        }}
        ownItems={ownItems}
        emphasize={!sellerIdentity}
        disabled={!canOpenTrade}
        disabledReason={disabledTradeReason}
      />
    ) : null;

  const tradeGateNotice =
    !canOpenTrade && disabledTradeReason ? (
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        {disabledTradeReason}
      </p>
    ) : null;
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
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed px-4 py-5">
          <p className="text-base font-semibold">Not Available</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This item is not currently available for purchase or trade.
          </p>
        </div>
        {watchReport ? (
          <div
            className="grid grid-cols-2 justify-items-center gap-2"
            role="group"
            aria-label="Listing actions"
          >
            {watchReport}
          </div>
        ) : null}
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

  // Cash buyers need a payment method, not payout onboarding: they are only
  // refunded to their original card. Trade escrow is different — either member
  // could receive fraud restitution, so both must pass the Identity_Gate before
  // a proposal can become a trade.
  //
  // Buy / Trade / Offer / Save / Report are compact icon chips above the
  // description. "Message seller" stays lower in the details rail.
  return (
    <div className="space-y-4">
      {!sellerIdentity ? (
        <div className="space-y-3 rounded-lg border border-dashed px-4 py-4">
          <div>
            <p className="text-base font-semibold">Payout setup needed</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This seller cannot accept a cash purchase or start trade escrow
              until their payout setup is complete. You can message them in the
              meantime.
            </p>
          </div>
          <div
            className="grid grid-cols-3 justify-items-center gap-2"
            role="group"
            aria-label="Listing actions"
          >
            {proposeTrade}
            {watchReport}
          </div>
        </div>
      ) : (
        <div
          className="grid grid-cols-5 justify-items-center gap-1 sm:gap-2"
          role="group"
          aria-label="Listing actions"
        >
          <BuyButton
            itemId={itemId}
            sellerIdentity={sellerIdentity}
            appearance="icon"
          />
          {proposeTrade}
          <MakeOfferDialog
            itemId={itemId}
            fmvCents={fmvCents}
            sellerIdentity={sellerIdentity}
            appearance="icon"
          />
          {watchReport}
        </div>
      )}
      {tradeGateNotice}
    </div>
  );
}
