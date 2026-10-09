import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { LogInIcon } from '@hugeicons/core-free-icons';

import { BuyButton, ShopfrontBuyButton } from '@/components/listings/BuyButton';
import { MakeOfferDialog } from '@/components/offers/MakeOfferDialog';
import { ProposeTradeDialog } from '@/components/trade/ProposeTradeDialog';
import { MessageSellerButton } from '@/components/messages/MessageSellerButton';
import { Button } from '@/components/ui/button';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import type { VerificationState } from '@/domain/identity/identityGate';
import type { TradeOfferOwnItem } from '@/components/trade/TradeOfferForm';

// THREE LABELLED BUTTONS, NOT FOUR GLYPHS AND A BUTTON. The bar used to be message,
// heart, offer and trade as icons with mixed borders, then Buy: five controls of
// which only one said what it did. Save now rides in the header and Message sits
// under the seller card, so the bar holds exactly the three ways to start a deal,
// each named — the shape every resale reference uses (Depop: Offer | Buy).
//
// Offer and Trade are outline and share the leftover width; Buy is the only filled
// control and takes a larger share, so the thing most buyers came to do is both the
// widest and the only coloured target.
const BAR_SECONDARY = 'h-11 min-h-11 min-w-0 flex-1 px-snug text-body';
const BAR_PRIMARY = 'h-11 min-h-11 min-w-0 flex-[1.4] px-cozy text-body font-semibold';

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
  currency,
  isAuthenticated,
  isShopfront,
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
  currency: string;
  isAuthenticated: boolean;
  isShopfront: boolean;
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

  // The seller cannot take a contract until their payout setup is done; the one
  // useful thing left is to ask them, so the bar becomes a single Chat action.
  if (!sellerIdentity) {
    return (
      <div data-hide-for-keyboard className={barClass}>
        <MessageSellerButton itemId={itemId} sellerId={sellerId} variant="bar" />
      </div>
    );
  }

  const showOffer = !isShopfront;

  return (
    <div data-hide-for-keyboard className={barClass}>
      {showOffer ? (
        <MakeOfferDialog
          itemId={itemId}
          fmvCents={fmvCents}
          currency={currency}
          sellerIdentity={sellerIdentity}
          trigger={
            <Button type="button" variant="outline" className={BAR_SECONDARY}>
              Offer
            </Button>
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
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(disabledTradeReason)}
            title={disabledTradeReason ?? undefined}
            className={BAR_SECONDARY}
          >
            Trade
          </Button>
        }
      />
      {isShopfront ? (
        <ShopfrontBuyButton
          itemId={itemId}
          sellerIdentity={sellerIdentity}
          trigger={
            // "Request", not "Browse": a binder's buy flow asks the buyer to describe
            // the cards they want and name a price.
            <Button type="button" variant="action" className={BAR_PRIMARY}>
              Request
            </Button>
          }
        />
      ) : (
        <BuyButton
          itemId={itemId}
          sellerIdentity={sellerIdentity}
          summary={{ title: itemTitle, imagePath: itemImagePath, priceCents: fmvCents, currency }}
          trigger={
            <Button type="button" variant="action" className={BAR_PRIMARY}>
              Buy
            </Button>
          }
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
  'fixed inset-x-0 bottom-[var(--mobile-hub-offset)] z-30 flex items-center gap-snug border-t border-border bg-card pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-snug pt-snug shadow-[0_-8px_24px_hsl(var(--obsidian)/0.06)] md:hidden';
