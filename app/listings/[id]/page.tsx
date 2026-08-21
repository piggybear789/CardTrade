// app/listings/[id]/page.tsx
//
// Item detail page (Req 3.8, 4.1, 5.1). A Server Component that loads a single
// Item via `getItem` (RLS returns it only when AVAILABLE or owned by the
// caller) and renders a split view: photos stay in the left pane, title, price,
// seller, and Buy / Propose trade sit in the right pane.
//
// Transaction entry points are gated by the viewer's context:
//   * Owner            -> Edit / Delete links (to /listings/[id]/edit).
//   * Authenticated non-owner, item AVAILABLE -> trade, and Cash Sale controls
//     only when the Seller has a provider-approved identity disclosure.
//   * Unauthenticated  -> a prompt linking to sign-in.
// The buy/trade actions re-enforce these gates server-side; the gating here
// only decides what to surface.

import { Suspense, ViewTransition } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  FileText,
  LogIn,
  Pencil,
} from "lucide-react";

import { getItem, type ItemRow } from "@/lib/actions/listings";
import { getWatchCount, isWatching } from "@/lib/actions/watchlist";
import { deriveItemTitle } from "@/domain/validation";
import { createClient } from "@/lib/supabase/server";
import { getCachedAuthUser } from "@/lib/supabase/cachedAuth";
import { readIdentityGate } from "@/lib/identityGate";
import { loadSellerIdentityDisclosure } from "@/lib/sellerIdentity";
import type { SellerIdentityDisclosure } from "@/domain/orchestrator/merchantOnboarding";
import type { VerificationState } from "@/domain/identity/identityGate";
import {
  checkRegionCompatibility,
  regionMismatchMessage,
} from "@/domain/region";
import { viewerTradingRegion } from "@/lib/location/resolveRegion";
import {
  formatAud,
  itemImageUrl,
} from "@/lib/format";
import { BuyButton, ShopfrontBuyButton } from "@/components/listings/BuyButton";
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
import { CloseShopfrontDialog } from "@/components/listings/CloseShopfrontDialog";
import { ReportDialog } from "@/components/reports/ReportDialog";
import { PayoutReturnRefresh } from "@/components/payouts/PayoutReturnRefresh";
import { StarRating } from "@/components/listings/StarRating";
import { IdentityBadge } from "@/components/identity/IdentityBadge";
import { MarketplaceShell } from "@/components/layout/MarketplaceShell";
import { Avatar } from "@/components/ui/avatar";
import { PlaceMap } from "@/components/location";
import type { PlacePrecision } from "@/lib/location/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusNotice } from "@/components/ui/status-notice";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

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
    return {
      title:
        result.error === "not-found"
          ? "Item not found · NoDitto"
          : "Listing · NoDitto",
    };
  }
  return {
    title: `${(result.data.title ?? '').trim() || deriveItemTitle(result.data.description ?? '')} · NoDitto`,
    description: (result.data.description ?? '').slice(0, 160),
  };
}

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabasePromise = createClient();
  const [result, user, supabase] = await Promise.all([
    getItem(id),
    getCachedAuthUser(),
    supabasePromise,
  ]);

  // Hidden / missing listings are a 404. A read or network failure is not —
  // that would claim the listing was removed when it may still be there.
  if (!result.ok) {
    if (result.error === "not-found") {
      notFound();
    }
    throw new Error(result.message ?? "Failed to load listing");
  }
  const item = result.data;
  const listingTitle = (item.title ?? '').trim() || deriveItemTitle(item.description ?? '');

  const isOwner = user?.id === item.owner_id;
  const status = (item.status as ItemStatus) ?? "AVAILABLE";
  // A shopfront is never reserved and never sold — several buyers hold their own
  // contracts against it at once — so `status` says nothing about whether it is
  // open for business. Being unclosed is the whole test (0064).
  const isShopfront = item.listing_kind === "SHOPFRONT";
  const isClosed = Boolean(item.closed_at);
  const statusBadge = isShopfront
    ? isClosed
      ? { variant: "outline" as const, label: "Closed" }
      : { variant: "default" as const, label: "Open" }
    : (STATUS_BADGE[status] ?? STATUS_BADGE.AVAILABLE);
  const isAvailable = isShopfront ? !isClosed : status === "AVAILABLE";

  // Authenticated non-owners: watch state, own goods for Propose Trade, and
  // public seller profile + identity can load together.
  //
  // A binder CAN be traded for since 0081. Its own FMV is still never bonded — the
  // binder side is valued at whatever is offered against it
  // (`domain/trade/tradeSideValues.ts`) — and the trade states which cards come out
  // of it, because the listing cannot.
  const canProposeTrade = Boolean(user && !isOwner && isAvailable);

  const viewerRegionPromise =
    user && !isOwner ? viewerTradingRegion() : Promise.resolve(null);

  const [
    initialWatching,
    watchCount,
    sellerRowResult,
    sellerIdentity,
    ownItemsResult,
    viewerTradeGate,
    viewerRegion,
    mySaleRow,
  ] = await Promise.all([
    user && !isOwner ? isWatching(item.id) : Promise.resolve(false),
    getWatchCount(item.id),
    supabase
      .from("public_profiles")
      .select(
        "display_name, rating, rating_count, is_verified, identity_first_name, region_code, avatar_path",
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
          // A shopfront cannot be offered into a trade: its FMV is a whole
          // binder, so the other trader would be bonded against an inventory.
          .eq("listing_kind", "SINGLE")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as ItemRow[] }),
    canProposeTrade ? readIdentityGate(user!.id) : Promise.resolve(null),
    viewerRegionPromise,
    user && !isOwner
      ? supabase
          .from("cash_sales")
          .select("id")
          .eq("item_id", item.id)
          .eq("buyer_id", user.id)
          .not("status", "in", '("COMPLETED","CANCELLED","FAILED","REFUNDED")')
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const sellerRow = sellerRowResult.data;
  const ownItems = (ownItemsResult.data ?? []) as ItemRow[];
  // The viewer's own gate no longer disables Propose Trade: an unverified viewer
  // gets a pressable button that opens verification (see ProposeTradeDialog).
  // `null` means "nothing to resolve".
  const viewerVerification =
    viewerTradeGate && !viewerTradeGate.satisfied ? viewerTradeGate.state : null;
  const sellerDisplayName =
    (sellerRow?.display_name as string | null)?.trim() || "The other trader";

  // Region compatibility, evaluated for DISPLAY only (0065).
  //
  // The authoritative refusal lives in the orchestrator and in
  // `openTradeNegotiation`; this exists so a signed-in viewer is told before they
  // commit rather than after. A member who reaches this page from a shared link or
  // their watchlist has bypassed the region-scoped catalog entirely, and letting
  // them fill in a contract only to have it refused at submit is the avoidable
  // version of the same outcome.
  //
  // Only computed for a signed-in non-owner: an anonymous visitor has no region to
  // compare, and warning them about a mismatch they cannot yet have would be noise.
  const viewerRegionMismatch =
    user && !isOwner
      ? checkRegionCompatibility(
          viewerRegion,
          (sellerRow?.region_code as string | null) ?? null,
        )
      : null;
  // A viewer who has simply not set their own region is NOT warned here: that is
  // their own incomplete onboarding rather than anything about this listing, and it
  // is already surfaced where it can be fixed. Only a genuine incompatibility.
  const regionNotice =
    viewerRegionMismatch && viewerRegionMismatch.reason !== 'UNKNOWN_REGION'
      ? regionMismatchMessage(viewerRegionMismatch)
      : null;

  // When the item is RESERVED and the viewer is the owner, resolve the active
  // contract (Cash_Sale or Trade) so we can link directly to the contract room.
  let activeSaleId: string | null = null;
  let activeTradeId: string | null = null;
  let openContracts: { id: string; buyerName: string; amountCents: number }[] = [];
  // THE VIEWER'S OWN LIVE CONTRACT on this item, if they have one.
  //
  // Both queries below are gated on `isOwner`, so a BUYER got nothing and the page offered
  // them Buy Now on a listing they already had a contract for. On a SINGLE listing that
  // click fails on `cash_sales_one_active_per_item`; on a binder it fails on
  // `cash_sales_one_active_per_shopfront_buyer`. Either way the buyer reads a constraint
  // violation instead of being taken to the contract they already have.
  //
  // Read for any signed-in non-owner, and RLS scopes it to their own rows.
  const myContractId = mySaleRow.data?.id ?? null;

  // A shopfront has MANY live contracts by design, so the owner gets the whole
  // list; a single listing has at most one and only while RESERVED.
  if (isOwner && isShopfront) {
    const { data: saleRows } = await supabase
      .from("cash_sales")
      .select("id, buyer_id, amount_cents, created_at")
      .eq("item_id", item.id)
      .not("status", "in", '("COMPLETED","CANCELLED","FAILED","REFUNDED")')
      .order("created_at", { ascending: false });

    const rows = saleRows ?? [];
    const buyerIds = Array.from(new Set(rows.map((row) => row.buyer_id)));
    const { data: buyers } = buyerIds.length
      ? await supabase
          .from("public_profiles")
          .select("id, display_name")
          .in("id", buyerIds)
      : { data: [] };
    const nameOf = new Map(
      (buyers ?? []).map((b) => [b.id as string, b.display_name as string]),
    );
    openContracts = rows.map((row) => ({
      id: row.id,
      buyerName: nameOf.get(row.buyer_id) ?? "A buyer",
      amountCents: row.amount_cents,
    }));
  } else if (isOwner && status === "RESERVED") {
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
    .map((src, index) => ({ src, alt: `${listingTitle} — image ${index + 1}` }));

  return (
    <MarketplaceShell
      title="Marketplace"
    >
      {/* Reconciles payout state when the viewer lands back here from the
          provider's hosted onboarding flow. Renders nothing. Suspense because it
          reads searchParams; the page is force-dynamic, so this never blocks a
          prerender. */}
      <Suspense fallback={null}>
        <PayoutReturnRefresh />
      </Suspense>

      {/* Split view (lg+): photos stay put, details scroll beside them.
          The wrapper is the workspace content box — 100dvh less the header
          (4rem + 1px + safe-area) and the section's vertical padding
          (4.25rem). Below lg the columns stack and the page scrolls. */}
      <div className="flex min-h-0 flex-col lg:h-[calc(100dvh-8.25rem-1px-env(safe-area-inset-top))]">
        <nav
          className="mb-2 flex flex-wrap items-center justify-between gap-2 sm:mb-3"
          aria-label="Listing"
        >
          <Button asChild variant="outline" size="sm">
            <Link href="/listings" transitionTypes={['nav-back']}>
              <ArrowLeft aria-hidden="true" />
              Back to listings
            </Link>
          </Button>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <Badge
              variant={statusBadge.variant}
              aria-label={`Availability: ${statusBadge.label}`}
            >
              {statusBadge.label}
            </Badge>
            {item.category ? <Badge variant="secondary">{item.category}</Badge> : null}
            <Badge variant="outline">{item.condition}</Badge>
            {watchCount > 0 ? (
              <span className="text-meta tabular-nums text-muted-foreground">
                {watchCount} {watchCount === 1 ? "save" : "saves"}
              </span>
            ) : null}
          </div>
        </nav>

        <div className="flex min-h-0 flex-col items-stretch gap-6 lg:flex-1 lg:flex-row">
          <div className="min-w-0 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
            <ViewTransition
              name={`listing-image-${item.id}`}
              share="morph"
              default="none"
            >
              <ImageGallery images={images} title={listingTitle} />
            </ViewTransition>
          </div>

          <div className="flex min-w-0 flex-col lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pb-7 lg:[-ms-overflow-style:none] lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
            <div className="flex h-full flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-balance text-head font-semibold tracking-tight">
              {listingTitle}
            </h2>
            <p className="mt-1 text-lead font-semibold tabular-nums tracking-tight">
              {formatAud(item.fmv_cents)}
            </p>
          </div>
          {user && !isOwner ? (
            <div
              className="flex shrink-0 items-center"
              role="group"
              aria-label="Listing actions"
            >
              <WatchButton
                itemId={item.id}
                initialWatching={initialWatching}
                variant="icon"
              />
              <ReportDialog
                targetType="item"
                targetId={item.id}
                triggerLabel="Report listing"
                appearance="icon-only"
              />
            </div>
          ) : null}
        </header>

        <section aria-labelledby="seller-heading">
          <h2 id="seller-heading" className="sr-only">
            Seller
          </h2>
          <Card className="p-group">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar
                avatarPath={(sellerRow?.avatar_path as string | null) ?? null}
                displayName={
                  isOwner
                    ? "You"
                    : ((sellerRow?.display_name as string | null) ?? null)
                }
                size="md"
              />
              <div className="min-w-0 space-y-tight">
                <div className="flex min-w-0 items-center gap-1">
                  {isOwner ? (
                    <p className="truncate text-lead font-semibold">You</p>
                  ) : (
                    <Link
                      href={`/sellers/${item.owner_id}`}
                      transitionTypes={['nav-forward']}
                      className="truncate text-lead font-semibold underline-offset-2 hover:underline"
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
                    className="text-meta"
                  />
                ) : (
                  <Link
                    href={`/sellers/${item.owner_id}#reviews`}
                    className="inline-flex rounded-sm border border-transparent transition-colors hover:opacity-80 focus:outline-none focus-visible:border-gold/40"
                    aria-label="Read seller reviews"
                  >
                    <StarRating
                      rating={sellerRow?.rating ?? null}
                      count={sellerRow?.rating_count ?? undefined}
                      size={12}
                      className="text-meta"
                    />
                  </Link>
                )}
                {/* Identity disclosure — visible to buyers so they know who
                    they're transacting with (Req 4.8). Lives inside the seller
                    card so the verified facts stay with the person. */}
                {sellerIdentity && !isOwner ? (
                  <dl className="flex min-w-0 flex-wrap gap-x-3 gap-y-0 text-meta leading-snug">
                    {/* "Real name" ONLY when a government document backs it.
                        `legalEntityName` is `identityCheckName ?? legalEntityName`,
                        and the fallback is seeded from the seller's own
                        `display_name` for members grandfathered by 0069 — so on
                        those rows this value is a self-chosen handle, and calling
                        it a real name would assert a document check that never
                        happened. `nameIsDocumentVerified` is the only thing that
                        can tell the two apart; do not label this from the value. */}
                    <div className="flex min-w-0 gap-tight">
                      <dt className="shrink-0 text-muted-foreground">
                        {sellerIdentity.nameIsDocumentVerified
                          ? "Real name"
                          : "Stated name"}
                      </dt>
                      <dd className="min-w-0 break-words font-medium">
                        {sellerIdentity.legalEntityName}
                      </dd>
                    </div>
                    {sellerIdentity.tradingName ? (
                      <div className="flex min-w-0 gap-tight">
                        <dt className="shrink-0 text-muted-foreground">
                          Trading as
                        </dt>
                        <dd className="min-w-0 break-words font-medium">
                          {sellerIdentity.tradingName}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
              </div>
            </div>
          </Card>
        </section>

        <section aria-labelledby="description-heading">
          <h2
            id="description-heading"
            className="mb-tight text-meta font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Description
          </h2>
          <p className="whitespace-pre-line break-words text-body leading-relaxed text-foreground">
            {item.description}
          </p>
        </section>

        {item.location_label ||
        (item.location_lat != null && item.location_lng != null) ? (
          <section
            aria-labelledby="location-heading"
            className="space-y-2"
          >
            <h2
              id="location-heading"
              className="text-meta font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Based near
            </h2>
            {/* A listing pin is a locality, never a street address — the
                precision is what keeps the frame honest about that. */}
            <PlaceMap
              lat={item.location_lat}
              lng={item.location_lng}
              label={item.location_label}
              precision={
                (item.location_precision as PlacePrecision | null) ?? 'suburb'
              }
              presentation="inline"
            />
          </section>
        ) : null}

        <div className="mt-auto space-y-4 pt-4">
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
            regionNotice={regionNotice}
            viewerVerification={viewerVerification}
            sellerIdentity={sellerIdentity}
            activeSaleId={activeSaleId}
            activeTradeId={activeTradeId}
            isShopfront={isShopfront}
            isClosed={isClosed}
            openContracts={openContracts}
            ownItems={ownItems}
            myContractId={myContractId}
          />

          {user && !isOwner && isAvailable && !myContractId ? (
            <section aria-labelledby="message-seller-heading">
              <h2 id="message-seller-heading" className="sr-only">
                Message seller
              </h2>
              <MessageSellerButton
                itemId={item.id}
                sellerId={item.owner_id}
                variant="inline"
              />
            </section>
          ) : null}
        </div>
            </div>
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
  sellerId: _sellerId,
  sellerDisplayName,
  fmvCents,
  isOwner,
  isAuthenticated,
  isAvailable,
  regionNotice,
  viewerVerification,
  sellerIdentity,
  activeSaleId,
  activeTradeId,
  isShopfront,
  isClosed,
  openContracts,
  ownItems,
  myContractId,
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
  /**
   * Why this viewer cannot contract on this listing across regions (0065), or null.
   *
   * Advisory copy only — the binding refusal is the orchestrator's. It is here so
   * a viewer who arrived from a link or their watchlist, bypassing the
   * region-scoped catalog, learns before filling in a contract rather than after.
   */
  regionNotice: string | null;
  viewerVerification: VerificationState | null;
  sellerIdentity: SellerIdentityDisclosure | null;
  activeSaleId: string | null;
  activeTradeId: string | null;
  /** A browsable inventory rather than one object for sale (0064). */
  isShopfront: boolean;
  isClosed: boolean;
  /** Every live contract against a shopfront; the owner sees them all. */
  openContracts: { id: string; buyerName: string; amountCents: number }[];
  ownItems: ItemRow[];
  /** The viewer's own live contract on this item, if any. */
  myContractId: string | null;
}) {
  // Only the SELLER's missing setup disables the trigger — the viewer cannot
  // complete somebody else's onboarding by pressing a button, so there is nothing
  // for a click to offer. The viewer's own gate is handled inside the dialog.
  const disabledTradeReason = !sellerIdentity
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
          isShopfront,
        }}
        ownItems={ownItems}
        emphasize={!sellerIdentity}
        viewerVerification={viewerVerification}
        returnPath={`/listings/${itemId}`}
        disabled={Boolean(disabledTradeReason)}
        disabledReason={disabledTradeReason}
      />
    ) : null;

  // Rendered as a warning rather than by disabling the controls. The region facts on
  // both sides can change (a member completes onboarding, sets a region), and a
  // disabled button with no explanation is the thing this is here to avoid. The
  // orchestrator refuses regardless, so nothing unsafe depends on this being read.
  const regionGateNotice = regionNotice ? (
    <StatusNotice description={regionNotice} />
  ) : null;
  // Owner controls: when the item is under contract, surface the active
  // contract link prominently instead of edit/delete (which aren't allowed on
  // RESERVED items anyway per Req 3.5).
  if (isOwner) {
    // A shopfront's owner sees EVERY live contract, not one. There is no single
    // "under contract" state to report, and a `.limit(1)` view would have hidden
    // the rest — including a second buyer asking for a card already promised.
    if (isShopfront) {
      return (
        <div className="space-y-4">
          {openContracts.length > 0 ? (
            <StatusNotice
              title={`${openContracts.length} open ${
                openContracts.length === 1 ? "contract" : "contracts"
              }`}
              description="Nothing here is reserved. Check what each buyer has asked for before you accept, so you don't promise the same card twice."
            >
              <ul className="flex flex-col gap-tight">
                {openContracts.map((contract) => (
                  <li key={contract.id}>
                    <Link
                      href={`/sales/${contract.id}`}
                      transitionTypes={['nav-forward']}
                      className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-body transition-colors hover:bg-muted/50"
                    >
                      <span className="min-w-0 truncate">{contract.buyerName}</span>
                      <span className="shrink-0 font-medium">
                        {formatAud(contract.amountCents)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </StatusNotice>
          ) : (
            <StatusNotice
              title="No open contracts"
              description="Buyers will ask for the cards they want, then you agree a price with each of them."
            />
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={`/listings/${itemId}/edit`} transitionTypes={['nav-forward']}>
                <Pencil aria-hidden />
                Edit listing
              </Link>
            </Button>
            {isClosed ? null : (
              <CloseShopfrontDialog itemId={itemId} itemTitle={itemTitle} />
            )}
          </div>
        </div>
      );
    }

    const hasContract = Boolean(activeSaleId || activeTradeId);
    if (hasContract) {
      const contractHref = activeSaleId
        ? `/sales/${activeSaleId}`
        : `/trades/${activeTradeId}`;
      const contractLabel = activeSaleId ? "Open Sale" : "Open Trade";
      return (
        <StatusNotice
          title="Under Contract"
          description={`This item is in an active ${activeSaleId ? "sale" : "trade"}. Manage it from the contract room.`}
        >
          <Button asChild className="w-full sm:w-auto">
            <Link href={contractHref}>
              <FileText aria-hidden />
              {contractLabel}
            </Link>
          </Button>
        </StatusNotice>
      );
    }

    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href={`/listings/${itemId}/edit`} transitionTypes={['nav-forward']}>
            <Pencil aria-hidden />
            Edit listing
          </Link>
        </Button>
        <CopyTradeLink itemId={itemId} />
        <DeleteListingDialog itemId={itemId} itemTitle={itemTitle} />
      </div>
    );
  }

  // THE VIEWER ALREADY HAS A CONTRACT ON THIS ITEM. Checked BEFORE the availability
  // branch, because that is exactly the case where a SINGLE listing is RESERVED — and
  // showing this buyer "Not Available" about goods they are currently buying would be the
  // least useful thing on the page. It also comes before the buy and trade affordances,
  // since both would fail on a uniqueness constraint they cannot see or fix.
  if (myContractId) {
    return (
      <StatusNotice
        title="You have a contract on this"
        description={
          isShopfront
            ? "You already have an open contract with this seller for items from this listing. Add anything else to that contract rather than starting a second one."
            : "You are already buying this item. Everything about the purchase lives on the contract."
        }
      >
        <Button asChild className="w-full">
          <Link href={`/sales/${myContractId}`} transitionTypes={['nav-forward']}>
            Go to your contract
          </Link>
        </Button>
      </StatusNotice>
    );
  }

  // Non-owner: the item must be AVAILABLE to buy or trade.
  if (!isAvailable) {
    return (
      <StatusNotice
        title={isShopfront ? "Closed" : "Not Available"}
        description={
          isShopfront
            ? "This seller has closed the listing, so it is not taking new requests."
            : "This item is not currently available for purchase or trade."
        }
      />
    );
  }

  // Unauthenticated visitors are prompted to sign in first (Req 1.7).
  if (!isAuthenticated) {
    return (
      <StatusNotice
        title="Sign In to Continue"
        description="Sign in to buy this item or propose a trade."
      >
        <Button asChild className="w-full sm:w-auto">
          <Link href={`/sign-in?redirectTo=/listings/${itemId}`}>
            <LogIn aria-hidden />
            Sign In
          </Link>
        </Button>
      </StatusNotice>
    );
  }

  // Cash buyers need a payment method, not payout onboarding: they are only
  // refunded to their original card. Trade collateral is different — either member
  // could receive fraud restitution, so both must pass the Identity_Gate before
  // a proposal can become a trade.
  //
  // Buy / trade / offer sit as one circular row. Message is a compose bar
  // underneath so it does not compete with opening a contract.
  const showOffer = Boolean(sellerIdentity) && !isShopfront;

  return (
    <div className="space-y-4">
      {!sellerIdentity ? (
        <div className="space-y-3">
          <StatusNotice
            title="Payout setup needed"
            description="This seller cannot accept a cash purchase or start a trade until their payout setup is complete. You can message them in the meantime."
          />
          <div
            className="flex items-start gap-2"
            role="group"
            aria-label="Start a contract"
          >
            <div className="min-w-0 flex-1">{proposeTrade}</div>
          </div>
        </div>
      ) : (
        <div
          className="flex items-start gap-2"
          role="group"
          aria-label="Start a contract"
        >
          <div className="min-w-0 flex-1">
            {isShopfront ? (
              <ShopfrontBuyButton
                itemId={itemId}
                sellerIdentity={sellerIdentity}
              />
            ) : (
              <BuyButton
                itemId={itemId}
                sellerIdentity={sellerIdentity}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">{proposeTrade}</div>
          {showOffer ? (
            <div className="min-w-0 flex-1">
              <MakeOfferDialog
                itemId={itemId}
                fmvCents={fmvCents}
                sellerIdentity={sellerIdentity}
              />
            </div>
          ) : null}
        </div>
      )}
      {regionGateNotice}
    </div>
  );
}
