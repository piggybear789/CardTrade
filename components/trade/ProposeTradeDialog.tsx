'use client';

// Propose a 2-way trade from the listing detail page — same form as
// /trades/new, presented as a sheet/dialog so Buy / Trade / Offer stay in place.
//
// VIEWER VERIFICATION IS A STEP, NOT A LOCK. When the viewer has not passed the
// Identity_Gate the trigger stays pressable and the dialog opens on a verification
// prompt instead of the offer form. The gate itself is unchanged — the offer form
// is still unreachable until the provider says the member is payable, and
// `proposeTradeAction` re-checks server-side (Req 14.2, 14.6). What changed is
// that the block is now actionable at the point of intent rather than a disabled
// chip with a sentence under it.
//
// The SELLER's setup is different and still disables the trigger: no amount of
// clicking by the viewer can complete somebody else's onboarding, so offering the
// form would only lead to a refusal at submit.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';

import { ListingActionIcon } from '@/components/listings/ListingActionIcon';
import { PayoutSetupPrompt } from '@/components/payouts/PayoutSetupPrompt';
import {
  TradeOfferForm,
  type TradeOfferRequested,
} from '@/components/trade/TradeOfferForm';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { VerificationState } from '@/domain/identity/identityGate';
import type { ItemRow } from '@/lib/actions/listings';

export interface ProposeTradeDialogProps {
  requested: TradeOfferRequested;
  ownItems: ItemRow[];
  /** `icon` matches the listing action row; `button` for denser placements. */
  appearance?: 'icon' | 'button';
  /** Filled chip when this is the only transactional CTA (trades-only sellers). */
  emphasize?: boolean;
  /**
   * The viewer's Identity_Gate state when it is NOT satisfied. Present means the
   * dialog opens on verification; `null` means it opens on the offer form.
   */
  viewerVerification?: VerificationState | null;
  /** Same-origin path to return to after the provider's hosted flow. */
  returnPath?: string;
  /** Blocks the trigger for reasons the viewer cannot resolve (seller setup). */
  disabled?: boolean;
  /** Member-safe explanation displayed by the containing listing action area. */
  disabledReason?: string | null;
}

export function ProposeTradeDialog({
  requested,
  ownItems,
  appearance = 'icon',
  emphasize = false,
  viewerVerification = null,
  returnPath,
  disabled = false,
  disabledReason = null,
}: ProposeTradeDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /**
   * Verification completed inside this dialog. The server-rendered
   * `viewerVerification` prop cannot update mid-dialog, so the prompt's callback
   * is what swaps in the offer form; `router.refresh()` then reconciles the page.
   */
  const [justVerified, setJustVerified] = useState(false);

  const needsVerification = Boolean(viewerVerification) && !justVerified;

  function handleSuccess() {
    setOpen(false);
    router.push('/trades');
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => setOpen(disabled ? false : next)}>
      <DialogTrigger asChild>
        {appearance === 'icon' ? (
          <ListingActionIcon
            icon={ArrowLeftRight}
            label="Propose Trade"
            variant={emphasize ? 'default' : 'outline'}
            disabled={disabled}
            title={disabledReason ?? undefined}
          />
        ) : (
          <Button
            type="button"
            variant={emphasize ? 'default' : 'outline'}
            disabled={disabled}
            title={disabledReason ?? undefined}
          >
            <ArrowLeftRight aria-hidden="true" />
            Propose Trade
          </Button>
        )}
      </DialogTrigger>
      {/*
        Long form: pin header + footer, scroll the middle. Default DialogContent
        scrolls the whole sheet, so a sticky action bar covers the totals. The
        verification step is short, so it sizes to its content instead.
      */}
      <DialogContent
        className={
          needsVerification
            ? 'min-w-0 sm:max-w-lg'
            : 'h-[min(92dvh,100dvh-env(safe-area-inset-top))] min-w-0 gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[min(92dvh,100dvh-3rem)] sm:max-w-lg'
        }
      >
        {needsVerification ? (
          <>
            <DialogHeader className="pr-10">
              <DialogTitle>One step before you trade</DialogTitle>
              <DialogDescription>
                Nothing is sent to {requested.ownerName} yet.
              </DialogDescription>
            </DialogHeader>
            <PayoutSetupPrompt
              state={viewerVerification!}
              blockedAction="trade"
              returnPath={returnPath ?? `/listings/${requested.id}`}
              onVerified={() => setJustVerified(true)}
            />
          </>
        ) : (
          <>
            <DialogHeader className="shrink-0 border-b border-border/70 px-4 pb-3 pt-2 pr-14 sm:px-6 sm:py-4">
              <DialogTitle>Offer a trade</DialogTitle>
              <DialogDescription>
                Nothing is reserved until {requested.ownerName} accepts.
              </DialogDescription>
            </DialogHeader>
            <TradeOfferForm
              requested={requested}
              ownItems={ownItems}
              layout="dialog"
              onSuccess={handleSuccess}
              onCancel={() => setOpen(false)}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
