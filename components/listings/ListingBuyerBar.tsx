import Link from 'next/link';
import { LogIn } from 'lucide-react';

import { BuyButton, ShopfrontBuyButton } from '@/components/listings/BuyButton';
import { WatchButton } from '@/components/listings/WatchButton';
import { MakeOfferDialog } from '@/components/offers/MakeOfferDialog';
import { ProposeTradeDialog } from '@/components/trade/ProposeTradeDialog';
import { MessageSellerButton } from '@/components/messages/MessageSellerButton';
import { Button } from '@/components/ui/button';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import type { VerificationState } from '@/domain/identity/identityGate';
import type { ItemRow } from '@/lib/actions/listings';

const BAR_TRIGGER =
  'h-11 min-h-11 w-full rounded-md px-2 text-body font-semibold';

/**
 * Flutter-style sticky buyer chrome. Replaces the mobile hub on an available
 * listing so Buy / Chat sit under the thumb the way they do in the app.
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
  ownItems: ItemRow[];
  disabledTradeReason: string | null;
}) {
  if (!isAuthenticated) {
    return (
      <div className={barClass}>
        <Button asChild className="h-11 w-full">
          <Link href={`/sign-in?redirectTo=/listings/${itemId}`}>
            <LogIn aria-hidden />
            Sign in to buy
          </Link>
        </Button>
      </div>
    );
  }

  const showOffer = Boolean(sellerIdentity) && !isShopfront;
  const showBuy = Boolean(sellerIdentity);

  return (
    <div className={barClass}>
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
              <Button type="button" variant="outline" className={`${BAR_TRIGGER} flex-1`}>
                Browse & Buy
              </Button>
            }
          />
        ) : (
          <BuyButton
            itemId={itemId}
            sellerIdentity={sellerIdentity!}
            trigger={
              <Button type="button" variant="outline" className={`${BAR_TRIGGER} flex-1`}>
                Buy Now
              </Button>
            }
          />
        )
      ) : null}
      <MessageSellerButton
        itemId={itemId}
        sellerId={sellerId}
        variant="bar"
      />
    </div>
  );
}

const barClass =
  'fixed inset-x-0 bottom-0 z-30 flex items-center gap-1 border-t border-border bg-card px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_hsl(var(--obsidian)/0.06)] md:hidden';
