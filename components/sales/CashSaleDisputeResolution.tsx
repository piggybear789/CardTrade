'use client';

// components/sales/CashSaleDisputeResolution.tsx
//
// Ending a disputed Cash_Sale without an arbitrator (0084).
//
// TWO CONTROLS, AND WHICH ONE YOU SEE DEPENDS ON WHAT IT COSTS YOU:
//
//   WITHDRAW      the raiser only. Drops their own claim; the contract carries on from
//                 the status it held before the dispute. No money moves at all.
//   SETTLE        each party may choose exactly one outcome, and it is the one against
//                 their own interest — a Buyer releases the payment to the Seller, a
//                 Seller refunds the Buyer in full.
//
// WHY THIS IS NOT THE THING THAT WAS DELETED. A participant-callable `resolveDispute`
// used to exist on the trade surface and was removed because it captured money FROM the
// counterparty: a party could decide their own case in their own favour. Every action
// here is a CONCESSION. Nothing on this panel can move money toward the person pressing
// the button, which is why it needs no arbitrator. A contested outcome — anything
// partial — is still staff-only, and the copy says so rather than leaving a member
// hunting for a control that does not exist.
//
// EACH CONTROL STATES ITS COST AT REST. These were two outline buttons in a row with no
// consequence attached until a dialog opened, which gave "refund the buyer in full" the
// same weight as "attach files" and put the whole explanation one click away. The
// consequence now sits beside the button, which is the pattern the Protection tab
// already argues for: the control belongs inside the sentence that sets the expectation.
//
// THE ORCHESTRATOR RE-CHECKS ALL OF IT. Hiding a button is presentation; `disputed_by`
// and the role/outcome pairing are enforced server-side, because these are Server
// Actions and an exported one is reachable by id.
//
// Confirmation is mandatory on all three paths. Two are irreversible transfers and the
// third abandons a claim, so each goes through `ConfirmDialog` rather than firing on a
// single click.

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderCircleIcon, RotateCcwIcon, Undo02Icon } from '@hugeicons/core-free-icons';

import {
  settleCashSaleDispute,
  withdrawCashSaleDispute,
} from '@/lib/actions/cashSale';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatMoney } from '@/lib/format';

/** Which confirmation is open. */
type Pending = 'withdraw' | 'settle' | null;

export interface CashSaleDisputeResolutionProps {
  cashSaleId: string;
  /** True when the viewer is the Buyer; drives which concession is offered. */
  iAmBuyer: boolean;
  /** True when the viewer raised this dispute. */
  iRaisedIt: boolean;
  /** Total collected from the Buyer, for the refund confirmation. */
  amountCents: number;
  /**
   * The contract's own currency.
   *
   * Not `formatAud`, which is the deprecated alias: the row records its denomination and
   * a concession dialog naming the wrong symbol is the exact silent error the money
   * rules in the steering docs exist to prevent.
   */
  currency: string;
  /** The other party's display name. */
  counterpartyName: string;
}

/** A concession and the sentence that says what it costs. */
function Choice({
  button,
  children,
}: {
  button: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-cozy gap-y-tight">
      {button}
      <p className="min-w-48 flex-1 text-pretty text-meta text-muted-foreground">
        {children}
      </p>
    </li>
  );
}

export function CashSaleDisputeResolution({
  cashSaleId,
  iAmBuyer,
  iRaisedIt,
  amountCents,
  currency,
  counterpartyName,
}: CashSaleDisputeResolutionProps) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState<Exclude<Pending, null> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const money = (cents: number) => formatMoney(cents, currency);

  function run(
    which: Exclude<Pending, null>,
    call: () => Promise<{ ok: boolean; message?: string; error?: string }>,
  ) {
    setRunning(which);
    setError(null);
    startTransition(async () => {
      const result = await call();
      setRunning(null);
      setPending(null);
      if (result.ok) {
        router.refresh();
      } else {
        // INLINE AS WELL AS A TOAST. The orchestrator's refusals here are facts about
        // the case rather than transient hiccups — "this dispute has already been
        // decided", "only the person who raised the dispute can withdraw it", "a partial
        // refund has to be agreed by both sides". A toast that vanishes after four
        // seconds is the wrong surface for a state the member has to act on.
        const message = result.message ?? 'That did not work. Try again.';
        setError(message);
        toast.error(message);
      }
    });
  }

  const busy = (which: Exclude<Pending, null>) => isPending && running === which;

  return (
    <section aria-labelledby="dispute-resolution-heading">
      <h4 id="dispute-resolution-heading" className="text-body font-semibold">
        Settle it yourself
      </h4>
      <p className="mt-1 text-pretty text-body text-muted-foreground">
        Only if you want it over now. You can choose an outcome that costs you, and
        nothing in between — a split is decided by support.
      </p>

      <ul className="mt-group space-y-cozy">
        {iRaisedIt ? (
          <Choice
            button={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                aria-busy={busy('withdraw')}
                onClick={() => setPending('withdraw')}
              >
                {busy('withdraw') ? (
                  <HugeiconsIcon icon={LoaderCircleIcon} className="size-4 animate-spin" aria-hidden />
                ) : (
                  <HugeiconsIcon icon={Undo02Icon} className="size-4" aria-hidden />
                )}
                Withdraw my report
              </Button>
            }
          >
            Drops your claim and the contract carries on. No money moves, and you can
            report a problem again if it is not resolved.
          </Choice>
        ) : null}

        <Choice
          button={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              aria-busy={busy('settle')}
              onClick={() => setPending('settle')}
            >
              {busy('settle') ? (
                <HugeiconsIcon icon={LoaderCircleIcon} className="size-4 animate-spin" aria-hidden />
              ) : (
                <HugeiconsIcon icon={RotateCcwIcon} className="size-4" aria-hidden />
              )}
              {iAmBuyer ? 'Release the payment anyway' : 'Refund the buyer in full'}
            </Button>
          }
        >
          {iAmBuyer
            ? `Ends the case in ${counterpartyName}'s favour and pays them ${money(amountCents)}. You keep what you received. Cannot be undone.`
            : `Ends the case in ${counterpartyName}'s favour for ${money(amountCents)}. If they hold the item they post it back first. Cannot be undone.`}
        </Choice>
      </ul>

      {error ? (
        <p role="alert" className="mt-cozy text-body text-destructive">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={pending === 'withdraw'}
        onOpenChange={(open) => !open && setPending(null)}
        title="Withdraw your report?"
        description={`The contract goes back to where it was before you raised it, and ${counterpartyName} is told you withdrew. No money moves. Your report and anything you filed stay on the record, and you can report a problem again if it is not resolved.`}
        confirmLabel="Withdraw report"
        pending={busy('withdraw')}
        onConfirm={() =>
          run('withdraw', () => withdrawCashSaleDispute(cashSaleId))
        }
      />

      <ConfirmDialog
        open={pending === 'settle'}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          iAmBuyer
            ? 'Release the payment to the seller?'
            : `Refund ${money(amountCents)} to the buyer?`
        }
        description={
          iAmBuyer
            ? `This ends the dispute and pays ${counterpartyName} for the item. You keep what you received. This cannot be undone, and you will not be able to dispute this contract again.`
            : // SUPERSEDED BY 0088. This used to warn that the buyer was NOT required
              // to send the item back, which was true when a full refund paid out
              // immediately. Return-conditional refunds changed that: if the buyer has
              // the goods, the refund now WAITS for them to post it back, and the
              // refund releases automatically once a carrier confirms it arrived.
              `This ends the dispute in ${counterpartyName}'s favour. If they already have the item, ` +
              `they must post it back to you first — the ${money(amountCents)} is refunded ` +
              `automatically once a carrier confirms it reached you, and your listing goes back on ` +
              `sale at that point. If the item never reached them, they are refunded straight away. ` +
              `This cannot be undone.`
        }
        confirmLabel={iAmBuyer ? 'Release the payment' : 'Refund in full'}
        confirmVariant="destructive"
        pending={busy('settle')}
        onConfirm={() =>
          run(
            'settle',
            () =>
              settleCashSaleDispute(
                cashSaleId,
                iAmBuyer ? 'RELEASE_SELLER' : 'REFUND_BUYER',
              ),
          )
        }
      />
    </section>
  );
}
