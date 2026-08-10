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
// THE ORCHESTRATOR RE-CHECKS ALL OF IT. Hiding a button is presentation; `disputed_by`
// and the role/outcome pairing are enforced server-side, because these are Server
// Actions and an exported one is reachable by id.
//
// Confirmation is mandatory on all three paths. Two are irreversible transfers and the
// third abandons a claim, so each goes through `ConfirmDialog` rather than firing on a
// single click.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, RotateCcw, Undo2 } from 'lucide-react';

import {
  settleCashSaleDispute,
  withdrawCashSaleDispute,
} from '@/lib/actions/cashSale';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatAud } from '@/lib/format';

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
  /** The other party's display name. */
  counterpartyName: string;
}

export function CashSaleDisputeResolution({
  cashSaleId,
  iAmBuyer,
  iRaisedIt,
  amountCents,
  counterpartyName,
}: CashSaleDisputeResolutionProps) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState<Exclude<Pending, null> | null>(null);

  function run(
    which: Exclude<Pending, null>,
    call: () => Promise<{ ok: boolean; message?: string; error?: string }>,
    success: string,
  ) {
    setRunning(which);
    startTransition(async () => {
      const result = await call();
      setRunning(null);
      setPending(null);
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.message ?? 'That did not work. Try again.');
      }
    });
  }

  const busy = (which: Exclude<Pending, null>) => isPending && running === which;

  return (
    <section
      aria-labelledby="dispute-resolution-heading"
      className="rounded-xl border bg-muted/30 p-4"
    >
      <h3 id="dispute-resolution-heading" className="text-sm font-semibold">
        End this without support
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Faster than waiting for a decision, and available while the case is open. You can
        only choose an outcome that costs you — anything in between is decided by support.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {iRaisedIt ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            aria-busy={busy('withdraw')}
            onClick={() => setPending('withdraw')}
          >
            {busy('withdraw') ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Undo2 className="size-4" aria-hidden />
            )}
            Withdraw my dispute
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          aria-busy={busy('settle')}
          onClick={() => setPending('settle')}
        >
          {busy('settle') ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RotateCcw className="size-4" aria-hidden />
          )}
          {iAmBuyer ? 'Release the payment anyway' : 'Refund the buyer in full'}
        </Button>
      </div>

      <ConfirmDialog
        open={pending === 'withdraw'}
        onOpenChange={(open) => !open && setPending(null)}
        title="Withdraw your dispute?"
        description={`The contract goes back to where it was before you raised it, and ${counterpartyName} is told you withdrew. No money moves. Your dispute and anything you submitted stay on the record, and you can raise a new dispute if the problem is not resolved.`}
        confirmLabel="Withdraw dispute"
        pending={busy('withdraw')}
        onConfirm={() =>
          run('withdraw', () => withdrawCashSaleDispute(cashSaleId), 'Dispute withdrawn.')
        }
      />

      <ConfirmDialog
        open={pending === 'settle'}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          iAmBuyer
            ? 'Release the payment to the seller?'
            : `Refund ${formatAud(amountCents)} to the buyer?`
        }
        description={
          iAmBuyer
            ? `This ends the dispute and pays ${counterpartyName} for the item. You keep what you received. This cannot be undone, and you will not be able to dispute this contract again.`
            : `This ends the dispute and returns the full ${formatAud(amountCents)} to ${counterpartyName}. The listing goes back on sale. This cannot be undone.`
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
            iAmBuyer ? 'Payment released.' : 'Buyer refunded.',
          )
        }
      />
    </section>
  );
}
