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

//
// ACTION ROWS, NOT BUTTONS. The first version was a heading ("End this without
// support"), a sentence explaining the rule, and two outline buttons — the reader had
// to hold the sentence in mind to know what either button would cost them. Each option
// is now one row that states its own consequence beneath its label, the shape
// `components/ui/dialog-row` uses for "there is more here": label, hint, chevron. The
// rule about partial outcomes is the section's one-line subtitle.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowRight01Icon,
  LoaderCircleIcon,
  RotateCcwIcon,
  Undo02Icon,
} from '@hugeicons/core-free-icons';

import {
  settleCashSaleDispute,
  withdrawCashSaleDispute,
} from '@/lib/actions/cashSale';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatAud } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Which confirmation is open. */
type Pending = 'withdraw' | 'settle' | null;

/** One way to end the dispute: what it is called, what it costs, and a way in. */
function ResolutionRow({
  icon,
  label,
  consequence,
  busy,
  disabled,
  onClick,
}: {
  icon: IconSvgElement;
  label: string;
  consequence: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-busy={busy}
        className="flex w-full items-center gap-cozy px-cozy py-cozy text-left transition-colors hover:bg-muted focus:outline-none focus-visible:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <HugeiconsIcon
            icon={busy ? LoaderCircleIcon : icon}
            className={cn('size-4', busy && 'animate-spin')}
            aria-hidden
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium">{label}</span>
          <span className="block text-meta text-muted-foreground">{consequence}</span>
        </span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </button>
    </li>
  );
}

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
  ) {
    setRunning(which);
    startTransition(async () => {
      const result = await call();
      setRunning(null);
      setPending(null);
      if (result.ok) {
        router.refresh();
      } else {
        toast.error(result.message ?? 'That did not work. Try again.');
      }
    });
  }

  const busy = (which: Exclude<Pending, null>) => isPending && running === which;

  return (
    <section aria-labelledby="dispute-resolution-heading">
      <h3 id="dispute-resolution-heading" className="text-body font-semibold">
        Settle it yourselves
      </h3>

      <ul className="mt-cozy divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {iRaisedIt ? (
          <ResolutionRow
            icon={Undo02Icon}
            label="Withdraw my dispute"
            consequence="No money moves."
            busy={busy('withdraw')}
            disabled={isPending}
            onClick={() => setPending('withdraw')}
          />
        ) : null}
        <ResolutionRow
          icon={RotateCcwIcon}
          label={iAmBuyer ? 'Release the payment anyway' : 'Refund the buyer in full'}
          consequence={
            iAmBuyer
              ? `Pays ${counterpartyName}. Cannot be undone.`
              : `Refunds ${counterpartyName} once the item is back. Cannot be undone.`
          }
          busy={busy('settle')}
          disabled={isPending}
          onClick={() => setPending('settle')}
        />
      </ul>

      <ConfirmDialog
        open={pending === 'withdraw'}
        onOpenChange={(open) => !open && setPending(null)}
        title="Withdraw your dispute?"
        description={`The contract goes back to where it was before you raised it, and ${counterpartyName} is told you withdrew. No money moves. Your dispute and anything you submitted stay on the record, and you can raise a new dispute if the problem is not resolved.`}
        confirmLabel="Withdraw dispute"
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
            : `Refund ${formatAud(amountCents)} to the buyer?`
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
              `they must post it back to you first — the ${formatAud(amountCents)} is refunded ` +
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
