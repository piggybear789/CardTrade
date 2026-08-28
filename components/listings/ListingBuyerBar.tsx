import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { LogInIcon } from '@hugeicons/core-free-icons';

import { BuyButton, ShopfrontBuyButton } from '@/components/listings/BuyButton';
import { WatchButton } from '@/components/listings/WatchButton';
import { MakeOfferDialog } from '@/components/offers/MakeOfferDialog';
import { ProposeTradeDialog } from '@/components/trade/ProposeTradeDialog';
import { MessageSellerButton } from '@/components/messages/MessageSellerButton';
import { Button } from '@/components/ui/button';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import type { VerificationState } from '@/domain/identity/identityGate';
import type { TradeOfferOwnItem } from '@/components/trade/TradeOfferForm';

const BAR_TRIGGER =
  'h-11 min-h-11 w-full rounded-md px-2 text-body font-semibold';

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
      <div className={guestBarClass}>
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
    <div className={memberBarClass}>
      <MessageSellerButton itemId={itemId} sellerId={sellerId} variant="icon" />
      <WatchButton
        itemId={itemId}
        initialWatching={initialWatching}
        variant="icon"
        className="size-11 rounded-full text-muted-foreground hover:text-foreground md:size-11"
      />
      {showOffer ? (
        <MakeOfferDialog
          itemId={itemId}
          fmvCents={fmvCents}
          sellerIdentity={sellerIdentity!}
          trigger={
            <button type="button" className={`${BAR_TRIGGER} w-auto shrink-0 px-2`}>
              Offer
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
            className={`${BAR_TRIGGER} w-auto shrink-0 px-2 disabled:opacity-50`}
          >
            Trade
          </button>
        }
      />
      {showBuy ? (
        isShopfront ? (
          <ShopfrontBuyButton
            itemId={itemId}
            sellerIdentity={sellerIdentity!}
            trigger={
              <Button type="button" variant="action" className={`${BAR_TRIGGER} flex-1`}>
                Browse
              </Button>
            }
          />
        ) : (
          <BuyButton
            itemId={itemId}
            sellerIdentity={sellerIdentity!}
            trigger={
              <Button type="button" variant="action" className={`${BAR_TRIGGER} flex-1`}>
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

const guestBarClass =
  'fixed inset-x-0 bottom-0 z-30 flex items-center gap-1 border-t border-border bg-card px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_hsl(var(--obsidian)/0.06)] md:hidden';

const memberBarClass =
  'fixed inset-x-0 z-30 flex items-center gap-1 border-t border-border bg-card px-3 pb-2 pt-2 shadow-[0_-8px_24px_hsl(var(--obsidian)/0.06)] md:hidden bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))]';
