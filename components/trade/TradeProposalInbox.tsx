'use client';

// components/trade/TradeProposalInbox.tsx
//
// Pending 2-Way Trade offers in both directions. Incoming offers are the only
// place a Trade can begin: accepting is what creates the Trade, reserves both
// Items, and places each Bond. Declining costs nothing on either side because
// nothing was held while the offer sat pending.
//
// A privately offered Item is marked as such: the recipient is being shown a
// collectible that is not in the catalog, and that is worth saying out loud.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeftRight, Coins, EyeOff, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatAud, formatRelativeTime, itemImageUrl } from '@/lib/format';
import {
  acceptTradeProposal,
  declineTradeProposal,
  withdrawTradeProposal,
  type TradeProposalSummary,
} from '@/lib/actions/tradeProposals';
import { summarizeHandover } from '@/lib/handover/terms';
import {
  EditTradeOfferDialog,
  type OfferableItem,
} from '@/components/trade/EditTradeOfferDialog';

/** Friendly copy for a failed response. */
const ERROR_MESSAGES: Record<string, string> = {
  'proposal-not-found': 'That offer no longer exists.',
  'not-permitted': 'You cannot respond to that offer.',
  'not-pending': 'That offer was already answered.',
  'item-unavailable': 'One of the items is no longer available.',
  unauthenticated: 'Sign in to respond.',
};

/** One item as it appears inside an offer row. */
function ItemChip({
  label,
  title,
  fmvCents,
  imagePath,
  hidden = false,
}: {
  label: string;
  title: string;
  fmvCents: number;
  imagePath: string | null;
  hidden?: boolean;
}) {
  const thumb = itemImageUrl(imagePath);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          width={96}
          height={96}
          className="size-12 shrink-0 rounded-md object-cover"
          loading="lazy"
        />
      ) : (
        <span className="size-12 shrink-0 rounded-md bg-muted" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
          {formatAud(fmvCents)}
          {hidden ? (
            <span className="inline-flex items-center gap-1 text-gold">
              <EyeOff className="size-3" aria-hidden="true" />
              Not listed
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

export function TradeProposalInbox({
  proposals,
  offerableItems = [],
}: {
  proposals: TradeProposalSummary[];
  /** The viewer's own AVAILABLE items, so an offer can be revised in place. */
  offerableItems?: OfferableItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Proposal awaiting an explicit accept confirmation: acceptance creates the
  // binding trade and places collateral, so it must never be a single tap.
  const [confirmingAcceptId, setConfirmingAcceptId] = useState<string | null>(null);

  if (proposals.length === 0) return null;

  function run(
    id: string,
    action: () => Promise<{ ok: boolean; error?: string; message?: string; tradeId?: string }>,
    successCopy: string,
  ) {
    setBusyId(id);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      if (result.ok) {
        toast.success(successCopy);
        if (result.tradeId) {
          router.push(`/trades/${result.tradeId}`);
          return;
        }
        router.refresh();
        return;
      }
      toast.error(
        result.message ??
          ERROR_MESSAGES[result.error ?? ''] ??
          'That did not work. Try again.',
      );
      router.refresh();
    });
  }

  const incoming = proposals.filter((p) => p.direction === 'incoming');
  const outgoing = proposals.filter((p) => p.direction === 'outgoing');

  return (
    <section aria-labelledby="trade-offers-heading" className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <h3 id="trade-offers-heading" className="text-lg font-semibold">
          Awaiting a decision
        </h3>
        {incoming.length > 0 ? <Badge>{incoming.length} for you</Badge> : null}
      </div>

      <ul className="space-y-3" aria-label="Pending trade offers">
        {[...incoming, ...outgoing].map((proposal) => {
          const busy = busyId === proposal.id && isPending;
          const isIncoming = proposal.direction === 'incoming';
          const viewerPaysCash =
            proposal.cashDirection === 'PROPOSER_PAYS' ? !isIncoming : isIncoming;
          return (
            <li key={proposal.id}>
              <Card>
                <CardContent className="space-y-4 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge
                        variant={isIncoming ? 'default' : 'outline'}
                        className="shrink-0 text-[0.6875rem]"
                      >
                        {isIncoming ? 'Needs your answer' : 'Waiting on them'}
                      </Badge>
                      <p className="min-w-0 truncate text-sm text-muted-foreground">
                        {isIncoming
                          ? `from ${proposal.counterpartyName}`
                          : `to ${proposal.counterpartyName}`}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(proposal.createdAt)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    {/* A bundle can be several items plus cash, so this side is a
                        list rather than a single chip. */}
                    <div className="min-w-0 flex-1 space-y-2">
                      {proposal.offered.map((item, index) => (
                        <ItemChip
                          key={item.id}
                          label={
                            index === 0
                              ? isIncoming
                                ? 'They give'
                                : 'You give'
                              : 'and'
                          }
                          title={item.title}
                          fmvCents={item.fmvCents}
                          imagePath={item.imagePath}
                          hidden={item.hidden}
                        />
                      ))}
                      {proposal.cashAmountCents > 0 ? (
                        <p className="flex items-center gap-2 pl-[3.75rem] text-sm font-semibold">
                          <Coins className="size-4 shrink-0 text-gold" aria-hidden="true" />
                          {viewerPaysCash ? 'You pay' : 'They pay'}{' '}
                          {formatAud(proposal.cashAmountCents)} via Stripe
                        </p>
                      ) : null}
                      {proposal.declaredValueCents ? (
                        <p className="pl-[3.75rem] text-xs text-muted-foreground">
                          {isIncoming ? 'They value' : 'You valued'} this side at{' '}
                          {formatAud(proposal.declaredValueCents)}
                        </p>
                      ) : null}
                    </div>
                    <ArrowLeftRight
                      className="size-4 shrink-0 self-center text-muted-foreground"
                      aria-hidden="true"
                    />
                    <ItemChip
                      label={isIncoming ? 'You give' : 'They give'}
                      title={proposal.requested.title}
                      fmvCents={proposal.requested.fmvCents}
                      imagePath={proposal.requested.imagePath}
                    />
                  </div>

                  {proposal.handoverMethod ? (
                    <p className="text-sm text-muted-foreground">
                      Delivery Terms:{' '}
                      <span className="font-medium text-foreground">
                        {summarizeHandover({
                          handover_method: proposal.handoverMethod,
                          meeting_location: proposal.meetingLocation,
                          delivery_cost_cents: proposal.deliveryCostCents,
                          delivery_details: proposal.deliveryDetails,
                        })}
                      </span>
                    </p>
                  ) : null}

                  {proposal.message ? (
                    <p className="break-words rounded-md bg-muted/40 p-3 text-sm">
                      {proposal.message}
                    </p>
                  ) : null}

                  <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                    {isIncoming ? (
                      <p className="text-xs text-muted-foreground">
                        Accepting puts each unverified side&apos;s card on the
                        line. Declining costs nothing.
                      </p>
                    ) : null}
                    {/* Full-height wrapping buttons: three actions on one row
                        overflow narrow phones, and Accept is high-stakes. */}
                    <div className="flex flex-wrap gap-2 sm:ml-auto">
                    {isIncoming ? (
                      <>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            run(
                              proposal.id,
                              () => declineTradeProposal(proposal.id),
                              'Offer declined.',
                            )
                          }
                        >
                          Decline
                        </Button>
                        <Button asChild variant="outline" disabled={busy}>
                          <Link
                            href={`/trades/new?counterpartItemId=${proposal.offered[0]?.id ?? ''}&counter=${proposal.id}`}
                          >
                            Counter
                          </Link>
                        </Button>
                        <Button
                          disabled={busy}
                          aria-busy={busy}
                          onClick={() => setConfirmingAcceptId(proposal.id)}
                        >
                          {busy ? (
                            <>
                              <Loader2 className="animate-spin" aria-hidden />
                              Accepting…
                            </>
                          ) : (
                            'Accept Trade'
                          )}
                        </Button>
                        <ConfirmDialog
                          open={confirmingAcceptId === proposal.id}
                          onOpenChange={(next) =>
                            setConfirmingAcceptId(next ? proposal.id : null)
                          }
                          title="Accept this trade?"
                          description={`Accepting creates a binding trade with ${proposal.counterpartyName}: both items are reserved and any required collateral is placed immediately.`}
                          confirmLabel="Accept Trade"
                          pending={busy}
                          onConfirm={() => {
                            setConfirmingAcceptId(null);
                            run(
                              proposal.id,
                              () => acceptTradeProposal(proposal.id),
                              'Trade accepted. Arranging collateral…',
                            );
                          }}
                        />
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          disabled={busy}
                          aria-busy={busy}
                          onClick={() =>
                            run(
                              proposal.id,
                              () => withdrawTradeProposal(proposal.id),
                              'Offer withdrawn.',
                            )
                          }
                        >
                          {busy ? (
                            <>
                              <Loader2 className="animate-spin" aria-hidden />
                              Withdrawing…
                            </>
                          ) : (
                            'Withdraw'
                          )}
                        </Button>
                        {/* Revise rather than withdraw and start over. */}
                        <EditTradeOfferDialog
                          proposalId={proposal.id}
                          primaryTitle={proposal.offered[0]?.title ?? 'your item'}
                          currentExtraItemIds={proposal.offered.slice(1).map((i) => i.id)}
                          offerableItems={offerableItems.filter(
                            (item) => item.id !== proposal.offered[0]?.id,
                          )}
                          currentCashCents={proposal.cashAmountCents}
                          currentCashDirection={proposal.cashDirection}
                          currentDeclaredValueCents={proposal.declaredValueCents}
                          currentMessage={proposal.message}
                          requestedFmvCents={proposal.requested.fmvCents}
                          currentHandoverMethod={proposal.handoverMethod}
                          currentMeetingLocation={proposal.meetingLocation}
                          currentDeliveryCostCents={proposal.deliveryCostCents}
                        />
                      </>
                    )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
