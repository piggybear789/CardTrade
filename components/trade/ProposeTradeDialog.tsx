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
import { useState, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeftRightIcon, ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { ListingActionIcon } from '@/components/listings/ListingActionIcon';
import {
  IdentityGatePrompt,
  identityGateDescription,
} from '@/components/identity/IdentityGatePrompt';
import {
  TradeOfferForm,
  type TradeOfferRequested,
} from '@/components/trade/TradeOfferForm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { VerificationState } from '@/domain/identity/identityGate';
import type { TradeOfferOwnItem } from '@/components/trade/TradeOfferForm';

export interface ProposeTradeDialogProps {
  requested: TradeOfferRequested;
  ownItems: TradeOfferOwnItem[];
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
  /** Replaces the default listing-action chip — used by the mobile buyer bar. */
  trigger?: ReactNode;
}

export function ProposeTradeDialog({
  requested,
  ownItems,
  emphasize = false,
  viewerVerification = null,
  returnPath,
  disabled = false,
  disabledReason = null,
  trigger,
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
        {trigger ?? (
          <ListingActionIcon
            icon={ArrowLeftRightIcon}
            // Matches the dialog's own title. The chip said "Propose Trade" and
            // the dialog then said "Offer a trade", so the thing you clicked and
            // the thing that opened had different names.
            label="Propose trade"
            variant={emphasize ? 'default' : 'outline'}
            disabled={disabled}
            title={disabledReason ?? undefined}
          />
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
            : // `sm:gap-0 sm:p-0` must be stated explicitly: the base DialogContent
              // sets `sm:p-6`/`sm:gap-4`, and a bare `p-0`/`gap-0` only overrides the
              // mobile classes — tailwind-merge keeps responsive variants separate,
              // so without these the desktop dialog double-pads (24px shell + 24px
              // header/body/footer).
              'h-[min(92dvh,100dvh-env(safe-area-inset-top))] min-w-0 gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[min(92dvh,100dvh-3rem)] sm:max-w-lg sm:gap-0 sm:p-0'
        }
      >
        {needsVerification ? (
          <>
            <DialogHeader className="gap-snug">
              <div className="flex items-center gap-snug">
                <HugeiconsIcon icon={ShieldCheckIcon} className="size-4 shrink-0 text-trust" aria-hidden />
                <div className="min-w-0 space-y-1.5">
                  <DialogTitle>Verify to trade</DialogTitle>
                  <DialogDescription className="text-pretty leading-relaxed">
                    {identityGateDescription(viewerVerification!, 'trade')}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <IdentityGatePrompt
              state={viewerVerification!}
              returnPath={returnPath ?? `/listings/${requested.id}`}
              onVerified={() => setJustVerified(true)}
            />
          </>
        ) : (
          <>
            {/* `pt-4`, not `pt-2`: the mobile close button is a 40px circle
                inset 12px from the top, so a title starting at 8px sat above
                its centre and read as crowded against it. */}
            <DialogHeader className="shrink-0 border-b border-border px-4 pb-3 pr-14 pt-4 sm:px-6 sm:py-4">
              <DialogTitle>Propose a trade</DialogTitle>
              {/* On a binder nothing is held even AFTER they accept — every other
                  listing reserves on acceptance, so saying "until they accept" here
                  would promise the opposite of what happens. */}
              <DialogDescription>
                {requested.isShopfront
                  ? `Nothing in this listing is held for you. ${requested.ownerName} can still sell the same cards to someone else.`
                  : `Nothing is reserved until ${requested.ownerName} accepts.`}
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
