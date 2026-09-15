import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowLeftRightIcon,
  HandCoinsIcon,
  LogInIcon,
} from '@hugeicons/core-free-icons';

import { BuyButton, ShopfrontBuyButton } from '@/components/listings/BuyButton';
import { WatchButton } from '@/components/listings/WatchButton';
import { MakeOfferDialog } from '@/components/offers/MakeOfferDialog';
import { ProposeTradeDialog } from '@/components/trade/ProposeTradeDialog';
import { MessageSellerButton } from '@/components/messages/MessageSellerButton';
import { Button } from '@/components/ui/button';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import type { VerificationState } from '@/domain/identity/identityGate';
import type { TradeOfferOwnItem } from '@/components/trade/TradeOfferForm';

// Offer and Trade: SECONDARY, and icon-only. A 44px square each, so the bar
// spends its width on Buy instead of on two labels that were competing with it.
//
// BORDERED, unlike the chat and heart glyphs beside them. Four bare icons in a
// row would read as one undifferentiated set of chrome; the border is what says
// these two open a contract and those two do not. Every glyph in the bar is
// 20px regardless of tier — that consistency is the point.
//
// `aria-label` IS THE LABEL, not a nicety. Icon-only means the accessible name
// is the only name, so both match their dialog's own title: click "Make an
// offer" and the dialog that opens says "Make an offer".
//
// NO SHARED WIDTH CLASS HERE, and that is what this constant's predecessor got
// wrong. It carried `w-full`, and the call sites appended `w-auto shrink-0`
// through a template string rather than `cn()` — so tailwind-merge never ran and
// both widths reached the DOM. Tailwind emits `w-full` after `w-auto`, so
// `w-full` won: with `shrink-0` beside it, Offer claimed 100% of the bar and
// refused to give any back. Trade was pushed off the right edge and Buy, holding
// only `flex-1`, collapsed to zero width — the listing had no visible Buy button
// at all, and the one control left on screen was a full-bleed Offer with its
// label centred, which is exactly how a primary action looks.
const BAR_SECONDARY =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:border-iris disabled:opacity-50';

// Buy: PRIMARY, and the only filled control in the bar. It takes the amber
// `action` fill and every pixel Offer and Trade did not need, so the thing the
// buyer came here to do is both the widest and the only coloured target.
// Safe to state a width here — `Button` composes through `cn()`, so
// tailwind-merge resolves this against the cva base rather than shipping both.
const BAR_PRIMARY =
  'h-11 min-h-11 min-w-0 flex-1 rounded-md px-3 text-body font-semibold';

// The two quiet glyphs. `[&_svg]:size-5` is load-bearing: `MessageSellerButton`
// draws its chat icon at `size-5` (20px) and `WatchButton`'s `icon` variant
// hardcodes `size-3.5` (14px) for the catalog card chrome, so side by side in
// one bar the heart rendered two-thirds the size of the bubble. Overriding from
// here keeps the card chrome at 14px where that is deliberate.
const BAR_GLYPH =
  'size-11 shrink-0 rounded-full text-muted-foreground hover:text-foreground [&_svg]:size-5';

/**
 * Sticky buyer chrome. Sits above the mobile hub when the viewer is signed
 * in, so Browse / Contracts stay reachable on every listing.
 */
export function ListingBuyerBar({
  itemId,
  itemTitle,
  itemImagePath,
  sellerId,
  sellerDisplayName,
  fmvCents,
  isAuthenticated,
  isShopfront,
  initialWatching,
  sellerIdentity,
  viewerVerification,
  ownItems,
  disabledTradeReason,
}: {
  itemId: string;
  itemTitle: string;
  itemImagePath: string | null;
  sellerId: string;
  sellerDisplayName: string;
  fmvCents: number;
  isAuthenticated: boolean;
  isShopfront: boolean;
  initialWatching: boolean;
  sellerIdentity: SellerIdentityDisclosure | null;
  viewerVerification: VerificationState | null;
  ownItems: TradeOfferOwnItem[];
  disabledTradeReason: string | null;
}) {
  if (!isAuthenticated) {
    return (
      <div data-hide-for-keyboard className={barClass}>
        <Button asChild className="h-11 w-full">
          <Link href={`/sign-in?redirectTo=/listings/${itemId}`}>
            <HugeiconsIcon icon={LogInIcon} aria-hidden />
            Sign in to buy
          </Link>
        </Button>
      </div>
    );
  }

  const showOffer = Boolean(sellerIdentity) && !isShopfront;
  const showBuy = Boolean(sellerIdentity);

  return (
    <div data-hide-for-keyboard className={barClass}>
      <MessageSellerButton itemId={itemId} sellerId={sellerId} variant="icon" />
      <WatchButton
        itemId={itemId}
        initialWatching={initialWatching}
        variant="icon"
        className={BAR_GLYPH}
      />
      {showOffer ? (
        <MakeOfferDialog
          itemId={itemId}
          fmvCents={fmvCents}
          sellerIdentity={sellerIdentity!}
          trigger={
            <button type="button" aria-label="Make an offer" className={BAR_SECONDARY}>
              <HugeiconsIcon icon={HandCoinsIcon} className="size-5" aria-hidden />
            </button>
          }
        />
      ) : null}
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
        viewerVerification={viewerVerification}
        returnPath={`/listings/${itemId}`}
        disabled={Boolean(disabledTradeReason)}
        disabledReason={disabledTradeReason}
        trigger={
          <button
            type="button"
            disabled={Boolean(disabledTradeReason)}
            title={disabledTradeReason ?? undefined}
            aria-label="Propose a trade"
            className={BAR_SECONDARY}
          >
            <HugeiconsIcon icon={ArrowLeftRightIcon} className="size-5" aria-hidden />
          </button>
        }
      />
      {showBuy ? (
        isShopfront ? (
          <ShopfrontBuyButton
            itemId={itemId}
            sellerIdentity={sellerIdentity!}
            trigger={
              // "Request", not "Browse". A binder's buy flow asks the buyer to
              // describe the cards they want and name a price, so "Browse"
              // described neither what the control does nor what the dialog
              // then shows — and the mobile hub's own "Browse" tab sits 56px
              // directly below it, which made the primary action on the page
              // look like a duplicate of the navigation.
              <Button type="button" variant="action" className={BAR_PRIMARY}>
                Request
              </Button>
            }
          />
        ) : (
          <BuyButton
            itemId={itemId}
            sellerIdentity={sellerIdentity!}
            trigger={
              <Button type="button" variant="action" className={BAR_PRIMARY}>
                Buy
              </Button>
            }
          />
        )
      ) : (
        <MessageSellerButton
          itemId={itemId}
          sellerId={sellerId}
          variant="bar"
        />
      )}
    </div>
  );
}

// One class for both viewers. The guest bar used to sit at `bottom-0` from when
// the hub was members-only; once the hub was mounted for guests too it painted
// straight over "Sign in to buy" — the only call to action an anonymous visitor
// gets, on the route most organic traffic lands on. Docking both variants off
// the same constant is what stops that pair drifting apart again.
const barClass =
  'fixed inset-x-0 bottom-[var(--mobile-hub-offset)] z-30 flex items-center gap-1.5 border-t border-border bg-card pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-2 pt-2 shadow-[0_-8px_24px_hsl(var(--obsidian)/0.06)] md:hidden';
