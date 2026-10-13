'use client';

// components/trade/TradeCashLeg.tsx
//
// The cash part of a swap, in the trade room (ESC-05 / ESC-06).
//
// The payer pays the agreed cash while the trade waits for its card holds, with the
// card issuer able to ask for a bank check, and the holds go on only once it is paid.
// The platform holds the cash until the trade completes, then releases it to the
// receiver; a cancelled or unwound trade refunds it. This replaces the old "Retry cash
// settlement" control, which charged the payer at completion with nothing behind it.
//
// A trade agreed before the switch has no cash leg row; for those the legacy notice
// (payout setup) still renders.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { PendingLabel } from '@/components/ui/pending-label';
import { getStripe, isRealPublishableKey } from '@/components/onboarding/stripeBrowser';
import {
  confirmTradeCashPayment,
  getTradeCashPaymentAction,
  payTradeCash,
  type TradeCashActionResult,
} from '@/lib/actions/tradeNegotiation';
import { formatContractDateTime, formatMoney } from '@/lib/format';
import type { TradeCashSettlementStatus, Tables } from '@/lib/supabase/database.types';

/** What the room needs to know about the cash leg. Read under RLS by the page. */
export interface TradeCashLegView {
  status: TradeCashSettlementStatus;
  payBy: string;
  holdReason: string | null;
  releaseAt: string | null;
}

async function runCheck(
  tradeId: string,
  nextAction: { clientSecret: string; publishableKey?: string },
): Promise<TradeCashActionResult> {
  const key = nextAction.publishableKey ?? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (isRealPublishableKey(key)) {
    const stripe = await getStripe(key!);
    if (stripe) {
      const { error } = await stripe.handleNextAction({ clientSecret: nextAction.clientSecret });
      const confirmed = await confirmTradeCashPayment(tradeId);
      if (error && confirmed.ok && confirmed.status === 'COLLECTING') {
        return {
          ok: false,
          error: 'cash-declined',
          message: error.message ?? 'Your bank check was not completed. You can try again.',
        };
      }
      return confirmed;
    }
  }
  return confirmTradeCashPayment(tradeId);
}

export function TradeCashLeg({
  trade,
  leg,
  cashDirection,
  cashAmountCents,
  cashReceiverPayoutReady,
}: {
  trade: Tables<'trades'>;
  leg: TradeCashLegView;
  cashDirection: 'incoming' | 'outgoing';
  cashAmountCents: number;
  cashReceiverPayoutReady: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const amount = formatMoney(cashAmountCents, trade.currency);
  const iPay = cashDirection === 'outgoing';
  const payBy = formatContractDateTime(leg.payBy) ?? leg.payBy;
  const awaitingPayment =
    trade.state === 'COLLATERAL_PENDING' && (leg.status === 'NOT_COLLECTED' || leg.status === 'COLLECTING');

  function pay() {
    startTransition(async () => {
      let result: TradeCashActionResult;
      if (leg.status === 'COLLECTING') {
        // A bank check is outstanding (reload, or another device): resume it.
        const action = await getTradeCashPaymentAction(trade.id);
        result =
          action.ok && action.clientSecret
            ? await runCheck(trade.id, {
                clientSecret: action.clientSecret,
                ...(action.publishableKey ? { publishableKey: action.publishableKey } : {}),
              })
            : await confirmTradeCashPayment(trade.id);
      } else {
        const paid = await payTradeCash(trade.id);
        result = paid.ok && paid.nextAction ? await runCheck(trade.id, paid.nextAction) : paid;
      }
      if (!result.ok) {
        toast.error(result.message ?? 'The payment did not go through. Nothing was charged.');
        return;
      }
      router.refresh();
    });
  }

  let title: string;
  let body: string;
  if (awaitingPayment) {
    title = iPay ? `Pay ${amount} to lock the trade` : `Waiting for the other trader to pay ${amount}`;
    body = iPay
      ? `NoDitto holds the cash until the trade completes, then releases it to the other trader. Pay by ${payBy}, or the trade is cancelled. The card holds go on after you pay.`
      : `They pay by ${payBy}. NoDitto holds the cash until the trade completes, then releases it to you.`;
  } else if (leg.status === 'COLLECTED') {
    title = `Cash of ${amount} paid`;
    body = iPay
      ? 'NoDitto is holding it. It is released to the other trader when the trade completes, or refunded to you if it is cancelled.'
      : 'NoDitto is holding it. It is released to you when the trade completes.';
  } else if (leg.status === 'RELEASE_PENDING') {
    title = `Cash of ${amount} is being released`;
    body = leg.holdReason
      ? 'On hold while support reviews the payment.'
      : leg.releaseAt
        ? `Released on ${formatContractDateTime(leg.releaseAt) ?? leg.releaseAt}.`
        : iPay
          ? 'It is on its way to the other trader.'
          : cashReceiverPayoutReady
            ? 'It is on its way to your payout account.'
            : 'Finish payout setup so it can be paid into your account.';
  } else if (leg.status === 'RELEASED') {
    title = `Cash of ${amount} released`;
    body = iPay ? 'The other trader has been paid.' : 'It has been paid to your payout account.';
  } else if (leg.status === 'REFUND_PENDING' || leg.status === 'REFUNDED') {
    title = leg.status === 'REFUNDED' ? `Cash of ${amount} refunded` : `Cash of ${amount} is being refunded`;
    body = iPay ? 'It goes back to the card you paid with.' : 'The trade did not go ahead, so the payer is refunded.';
  } else {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-muted px-group py-cozy text-body">
      <p className="font-medium">{title}</p>
      <p className="mt-tight text-muted-foreground">{body}</p>
      {awaitingPayment && iPay ? (
        <Button type="button" size="sm" className="mt-cozy" disabled={isPending} onClick={pay}>
          <PendingLabel pending={isPending} pendingLabel="Paying…" spinner={false}>
            {leg.status === 'COLLECTING' ? 'Complete payment' : `Pay ${amount}`}
          </PendingLabel>
        </Button>
      ) : null}
      {!iPay && !cashReceiverPayoutReady && leg.status !== 'REFUND_PENDING' && leg.status !== 'REFUNDED' ? (
        <Button asChild size="sm" variant="outline" className="mt-cozy">
          <Link href="/profile?tab=payouts">Set up payouts</Link>
        </Button>
      ) : null}
    </div>
  );
}
