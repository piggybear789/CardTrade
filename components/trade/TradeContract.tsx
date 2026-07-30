'use client';

// components/trade/TradeContract.tsx
//
// The flagship real-time Trade Contract view (Req 11), on the same three pieces as the
// cash sale and deal rooms:
//
//   header        2-way swap · value each side · You ⇄ Ada ✓ · Trade_State
//   ┌ your move ─────────────────────┬ chat ──────┐
//   └────────────────────────────────┴────────────┘
//   ●──●──○──○──○   Collateral Send Receive Accept Released
//   Swap · Collateral · Demo                          (collapsed rows)
//
// The action card holds `ActionBar`, which remains the single place trade actions are
// wired — the state machine decides what appears, not this component (Req 11.3, 11.4).
// The rail is `deriveTradeSteps`, which reads the same TradeFacts the state machine
// consumes, so the two can never disagree.
//
// All live state arrives over the realtime channel, so Trade_State and hold changes
// render without a reload (Req 11.2), including the connection indicator (Req 11.5,
// shown only while degraded) and the fraud outcome (Req 8.4).

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { formatAud, formatContractDateTime, itemImageUrl } from '@/lib/format';
import {
  deliveryNotesFromDetails,
  summarizeHandover,
} from '@/lib/handover/terms';
import { retrySettleTradeCash } from '@/lib/actions/trades';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ActionBar } from '@/components/trade/ActionBar';
import { HoldStatus } from '@/components/trade/HoldStatus';
import { StateBadge } from '@/components/trade/StateBadge';
import { TradeHandoverTermsEditor } from '@/components/trade/TradeHandoverTermsEditor';
import { PlaceMap } from '@/components/location';
import {
  ContractActionCard,
  ContractConversationPanel,
  ContractDetailList,
  ContractDetailRow,
  ContractExchangePanel,
  ContractFocusProvider,
  ContractHeader,
  ContractLiveRow,
  ContractMoneyTable,
  ContractPartyLine,
  ContractProgressRail,
  ContractTimeline,
  useContractConversation,
  type ContractActionTone,
  type ContractEvent,
  type ContractExchangeItem,
  type ContractParty,
} from '@/components/contract';
import { TRADE_SECTIONS, currentStep, deriveTradeSteps } from '@/domain/contract';
import { ensureTradeConversation } from '@/lib/actions/trades';
import { availableActions } from '@/domain/state-machine/actions';
import {
  useTradeRealtime,
  type TradeRow,
  type TradeTransitionRow,
} from '@/lib/realtime/useTradeRealtime';
import type {
  TradeFacts,
  TradeState,
  TradeViewerContext,
  TradeViewerRole,
} from '@/domain/state-machine/types';
import type { ReactNode } from 'react';

/**
 * Derive the aggregate TradeFacts snapshot the state machine needs from the live trade
 * row + holds. Mirrors the server-side derivation (which lives in a server-only module)
 * so it can run in the browser. Shipment/receipt/acceptance legs come from the
 * per-trader timestamps; hold activity from the live holds.
 */
function deriveFacts(
  trade: TradeRow,
  holds: { trader_id: string; status: string }[],
): TradeFacts {
  const holdActive = (traderId: string) =>
    holds.some((h) => h.trader_id === traderId && h.status === 'ACTIVE');
  return {
    shipped: {
      initiator: trade.initiator_shipped_at != null,
      counterpart: trade.counterpart_shipped_at != null,
    },
    received: {
      initiator: trade.initiator_received_at != null,
      counterpart: trade.counterpart_received_at != null,
    },
    accepted: {
      initiator: trade.initiator_accepted_at != null,
      counterpart: trade.counterpart_accepted_at != null,
    },
    holdsActive: {
      initiator: holdActive(trade.initiator_id),
      counterpart: holdActive(trade.counterpart_id),
    },
  };
}

/** How loudly the action card should read for each Trade_State. */
const STATE_TONE: Partial<Record<TradeState, ContractActionTone>> = {
  COMPLETED: 'success',
  COLLATERAL_LOCKED: 'success',
  DISPUTED: 'danger',
  FRAUD_RESOLVED: 'danger',
};

/** One item on either side of the agreed swap. */
export interface TradeGood {
  id: string;
  title: string;
  fmvCents: number;
  imagePath: string | null;
}

/** What each side agreed to hand over, resolved on the server. */
export interface TradeGoods {
  yours: TradeGood[];
  theirs: TradeGood[];
  cashAmountCents: number;
  /** Whether the viewer pays the cash or receives it. */
  cashDirection: 'incoming' | 'outgoing';
}

/** Total Fair_Market_Value of one side of the swap, in integer AUD cents. */
function sideValueCents(items: TradeGood[]): number {
  return items.reduce((total, item) => total + item.fmvCents, 0);
}

/** Map trade goods into the shared exchange-panel item shape. */
function toExchangeItems(items: TradeGood[]): ContractExchangeItem[] {
  return items.map((item) => {
    const url = itemImageUrl(item.imagePath);
    return {
      id: item.id,
      title: item.title,
      valueCents: item.fmvCents,
      images: url ? [url] : [],
    };
  });
}

/** Reputation summary for one trader, shown in the compact party line. */
export interface TradeParty {
  name: string;
  verified: boolean;
  rating: number | null;
  ratingCount: number;
}

/**
 * Map a trader into the shared contract party shape. A trade is symmetric, so both sides
 * carry the same role label and the same kind of exposure.
 */
function toContractParty(party: TradeParty, stakeCents: number): ContractParty {
  return {
    name: party.name,
    roleLabel: 'Trader',
    verified: party.verified,
    rating: party.rating,
    ratingCount: party.ratingCount,
    stats:
      stakeCents > 0
        ? [{ label: 'Item value', value: formatAud(stakeCents) }]
        : undefined,
  };
}

export interface TradeContractProps {
  tradeId: string;
  /** The two participants, resolved on the server from the trade row. */
  initiatorId: string;
  counterpartId: string;
  /** The viewer's role relative to this trade, resolved on the server. */
  viewerRole: TradeViewerRole;
  /** The agreed goods and cash, so both traders can see the whole deal. */
  goods?: TradeGoods;
  /** Compact reputation context for both traders, resolved on the server. */
  participants?: { initiator: TradeParty; counterpart: TradeParty };
  /**
   * Whether the cash receiver can take payouts right now. Used to warn before
   * completion; after completion `manual_reconciliation` is the source of truth.
   */
  cashReceiverPayoutReady?: boolean;
  /**
   * Slot for the Demo panel (task 15.3). The panel is a separate deliverable; this view
   * accepts it as a prop and mounts it in the collapsed detail rows.
   */
  demoPanel?: ReactNode;
}

/** Banner when cash is waiting on payout setup or a failed transfer. */
function TradeCashSettlementNotice({
  trade,
  cashDirection,
  cashAmountCents,
  cashReceiverPayoutReady,
}: {
  trade: TradeRow;
  cashDirection: 'incoming' | 'outgoing';
  cashAmountCents: number;
  cashReceiverPayoutReady: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [cleared, setCleared] = useState(false);

  if (cashAmountCents <= 0 || cleared) return null;

  const pendingAfterComplete =
    trade.state === 'COMPLETED' && trade.manual_reconciliation;
  // Trades have no CANCELLED state — a failed hold simply never reaches
  // COLLATERAL_LOCKED — so only the two terminal states end the reminder.
  const waitingBeforeComplete =
    trade.state !== 'COMPLETED' &&
    trade.state !== 'FRAUD_RESOLVED' &&
    !cashReceiverPayoutReady;

  if (!pendingAfterComplete && !waitingBeforeComplete) return null;

  const iReceive = cashDirection === 'incoming';
  const amount = formatAud(cashAmountCents);

  return (
    <div className="rounded-lg border border-dashed border-gold/50 bg-gold/10 px-4 py-3 text-sm">
      {pendingAfterComplete ? (
        <>
          <p className="font-medium">
            {iReceive
              ? `${amount} cash is waiting on your payout setup`
              : `${amount} cash is waiting on their payout setup`}
          </p>
          <p className="mt-1 text-muted-foreground">
            {iReceive
              ? 'Finish DittoShield so Pinch Payments can pay the cash into your account, then retry.'
              : 'They need to finish payout setup before Pinch Payments can move the cash. You can retry once they have.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {iReceive ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/profile#payouts">Set up payouts</Link>
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await retrySettleTradeCash(trade.id);
                  if (!result.ok) {
                    toast.error(
                      result.error === 'not-ready'
                        ? iReceive
                          ? 'Finish payout setup first, then try again.'
                          : 'They still need to finish payout setup.'
                        : 'Cash could not be settled yet. Try again shortly.',
                    );
                    return;
                  }
                  setCleared(true);
                  toast.success('Cash settled.');
                });
              }}
            >
              {isPending ? 'Settling…' : 'Retry cash settlement'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="font-medium">
            {iReceive
              ? `Cash of ${amount} settles after you finish payout setup`
              : `Cash of ${amount} settles after they finish payout setup`}
          </p>
          <p className="mt-1 text-muted-foreground">
            You can keep trading — collateral covers the goods. Pinch Payments
            moves the cash once the receiver can take payouts.
          </p>
          {iReceive ? (
            <Button asChild size="sm" variant="outline" className="mt-3">
              <Link href="/profile#payouts">Set up payouts</Link>
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** True while either trader may still change face-to-face / postage terms. */
function canEditHandoverTerms(trade: TradeRow): boolean {
  return (
    (trade.state === 'COLLATERAL_PENDING' || trade.state === 'COLLATERAL_LOCKED') &&
    trade.initiator_shipped_at == null &&
    trade.counterpart_shipped_at == null
  );
}

/** True when method-specific details (place or postage) are filled in. */
function areHandoverDetailsFilled(trade: TradeRow): boolean {
  if (trade.handover_method === 'IN_PERSON') {
    return Boolean(trade.meeting_location?.trim());
  }
  if (trade.handover_method === 'DELIVERY') {
    return trade.delivery_cost_cents != null;
  }
  return false;
}

function trackingLabel(
  carrier: string | null | undefined,
  number: string | null | undefined,
): string {
  if (!carrier?.trim() || !number?.trim()) return 'Not shipped yet';
  return `${carrier.trim()} · ${number.trim()}`;
}

/**
 * DELIVERY terms as postage + free-text notes. Putting the whole
 * `delivery_details` blob under a bare "Delivery" label left the panel looking
 * empty when notes were blank — cash sales show cost as the value instead.
 */
function deliveryTermsRows(trade: TradeRow) {
  const cost = trade.delivery_cost_cents;
  const notes = deliveryNotesFromDetails(trade.delivery_details);
  return [
    {
      label: 'Postage',
      value:
        cost == null ? 'Not set' : cost === 0 ? 'Free' : formatAud(cost),
      muted: cost == null,
    },
    ...(notes
      ? [{ label: 'Notes', hint: notes, value: '' as const }]
      : []),
  ];
}

/** Map state-machine audit rows onto the shared timeline shape. */
function toContractEvents(
  transitions: TradeTransitionRow[],
): ContractEvent[] {
  return transitions.map((row) => ({
    id: row.id,
    event: row.event,
    detail: `${row.from_state.replace(/_/g, ' ').toLowerCase()} → ${row.to_state
      .replace(/_/g, ' ')
      .toLowerCase()}`,
    created_at: row.created_at,
    actor_id: row.requested_by,
  }));
}

/** Terms row — meeting / delivery, editable until first ship. */
function TradeTermsRow({
  trade,
  viewerRole,
}: {
  trade: TradeRow;
  viewerRole: TradeViewerRole;
}) {
  const editable = canEditHandoverTerms(trade);
  const summary = trade.handover_method
    ? summarizeHandover({
        handover_method: trade.handover_method,
        meeting_location: trade.meeting_location,
        delivery_cost_cents: trade.delivery_cost_cents,
        delivery_details: trade.delivery_details,
      })
    : 'Not agreed yet';

  const myTracking = trackingLabel(
    viewerRole === 'INITIATOR'
      ? trade.initiator_tracking_carrier
      : trade.counterpart_tracking_carrier,
    viewerRole === 'INITIATOR'
      ? trade.initiator_tracking_number
      : trade.counterpart_tracking_number,
  );
  const theirTracking = trackingLabel(
    viewerRole === 'INITIATOR'
      ? trade.counterpart_tracking_carrier
      : trade.initiator_tracking_carrier,
    viewerRole === 'INITIATOR'
      ? trade.counterpart_tracking_number
      : trade.initiator_tracking_number,
  );

  return (
    <ContractDetailRow
      id={TRADE_SECTIONS.terms}
      label="Terms"
      summary={summary}
      action={
        editable ? (
          <TradeHandoverTermsEditor
            trade={trade}
            triggerLabel={trade.handover_method ? 'Edit terms' : 'Set delivery terms'}
          />
        ) : null
      }
      contentClassName="space-y-3"
    >
      {trade.handover_method === null ? (
        <p className="text-muted-foreground">
          Not agreed yet — choose face to face or delivery, then fill in the
          details.
        </p>
      ) : !areHandoverDetailsFilled(trade) ? (
        <p className="text-muted-foreground">
          {trade.handover_method === 'IN_PERSON'
            ? 'Face to face — add a meeting place when you both know where to meet.'
            : 'Delivery — agree postage and notes here; add tracking when you ship.'}
        </p>
      ) : (
        <>
          <ContractMoneyTable
            ariaLabel="Delivery terms"
            rows={
              trade.handover_method === 'IN_PERSON'
                ? [
                    {
                      label: 'Meeting point',
                      hint: trade.meeting_location,
                      value: '',
                    },
                    {
                      label: 'When',
                      value:
                        formatContractDateTime(trade.meeting_at) ??
                        'Not agreed yet',
                      muted: !trade.meeting_at,
                    },
                  ]
                : deliveryTermsRows(trade)
            }
          />
          {trade.handover_method === 'IN_PERSON' &&
          (trade.meeting_lat != null || trade.meeting_location) ? (
            <PlaceMap
              lat={trade.meeting_lat}
              lng={trade.meeting_lng}
              label={trade.meeting_location}
              heightClassName="h-40"
            />
          ) : null}
          {trade.handover_method === 'DELIVERY' ? (
            <ContractMoneyTable
              ariaLabel="Shipment tracking"
              rows={[
                {
                  label: 'Your tracking',
                  hint: myTracking,
                  value: '',
                  muted: myTracking === 'Not shipped yet',
                },
                {
                  label: 'Their tracking',
                  hint: theirTracking,
                  value: '',
                  muted: theirTracking === 'Not shipped yet',
                },
              ]}
            />
          ) : null}
        </>
      )}
      {editable ? (
        <p className="text-xs text-muted-foreground">
          Either trader can update delivery terms until someone marks the goods as
          shipped.
        </p>
      ) : null}
    </ContractDetailRow>
  );
}

/**
 * The live Trade Contract view. Bootstrapped with the participants + viewer role from
 * the server; all live state comes from the realtime hook.
 */
export function TradeContract({
  tradeId,
  initiatorId,
  counterpartId,
  viewerRole,
  goods,
  participants,
  cashReceiverPayoutReady = true,
  demoPanel,
}: TradeContractProps) {
  const { trade, holds, transitions, connectionStatus } =
    useTradeRealtime(tradeId);

  const viewer = useMemo<TradeViewerContext | null>(() => {
    if (!trade) return null;
    return { role: viewerRole, facts: deriveFacts(trade, holds) };
  }, [trade, holds, viewerRole]);

  // How many actions the state machine permits the viewer right now — drives the
  // "no actions available" helper text (Req 11.4).
  const permittedActionCount =
    trade && viewer ? availableActions(trade.state, viewer).length : 0;

  // An accepted trade is a contract room just like a Cash_Sale or Deal, so it gets the
  // same participant-only chat. Trades accepted before the thread existed self-heal on
  // first view (demo-contract-ux Req 1, 2).
  const chat = useContractConversation(
    trade?.conversation_id ?? null,
    async () => {
      if (!trade) return null;
      const result = await ensureTradeConversation(trade.id);
      return result.ok ? result.conversationId : null;
    },
    { enabled: trade !== null },
  );

  const me = viewerRole === 'INITIATOR' ? participants?.initiator : participants?.counterpart;
  const them = viewerRole === 'INITIATOR' ? participants?.counterpart : participants?.initiator;
  const myUserId = viewerRole === 'INITIATOR' ? initiatorId : counterpartId;
  const theirName = them?.name ?? 'the other trader';

  const yoursValueCents = sideValueCents(goods?.yours ?? []);
  const theirsValueCents = sideValueCents(goods?.theirs ?? []);
  const heldCents = holds.reduce((sum, hold) => sum + hold.amount_cents, 0);
  const history = toContractEvents(transitions);
  const latestEvent = history.length > 0 ? history[history.length - 1] : null;

  const steps =
    trade && viewer
      ? deriveTradeSteps({
          state: trade.state,
          viewerRole,
          facts: viewer.facts,
          counterpartyName: theirName,
        })
      : [];
  const step = currentStep(steps);

  return (
    <ContractFocusProvider>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <ContractHeader
          title="2-way trade"
          money={
            goods
              ? `${formatAud(yoursValueCents)} ⇄ ${formatAud(theirsValueCents)}${
                  goods.cashAmountCents > 0
                    ? ` + ${formatAud(goods.cashAmountCents)} cash`
                    : ''
                }`
              : undefined
          }
          parties={
            me && them ? (
              <ContractPartyLine
                me={toContractParty(me, yoursValueCents)}
                them={toContractParty(them, theirsValueCents)}
              />
            ) : null
          }
          status={trade ? <StateBadge state={trade.state} /> : null}
          connectionStatus={connectionStatus}
        />

        {trade === null ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-hidden />
              Loading trade…
            </CardContent>
          </Card>
        ) : (
          <>
            {goods ? (
              <TradeCashSettlementNotice
                trade={trade}
                cashDirection={goods.cashDirection}
                cashAmountCents={goods.cashAmountCents}
                cashReceiverPayoutReady={cashReceiverPayoutReady}
              />
            ) : null}

            <ContractLiveRow
              action={
                <ContractActionCard step={step} tone={STATE_TONE[trade.state]}>
                  {viewer && permittedActionCount > 0 ? (
                    <ActionBar
                      tradeId={tradeId}
                      state={trade.state}
                      viewer={viewer}
                      handoverMethod={trade.handover_method}
                    />
                  ) : null}

                  {trade.state === 'FRAUD_RESOLVED' ? (
                    <p className="text-xs text-muted-foreground">
                      The other trader&apos;s deposit was paid to you.
                    </p>
                  ) : null}
                </ContractActionCard>
              }
              conversation={
                <ContractConversationPanel
                  conversationId={chat.conversationId}
                  currentUserId={myUserId}
                  counterpartyName={theirName}
                  title="Chat"
                  placeholder="Message about the trade…"
                  emptyHint="Use chat to coordinate shipping and receipt."
                  failed={chat.failed}
                  onRetry={chat.retry}
                />
              }
              progress={<ContractProgressRail steps={steps} />}
            >
              <ContractDetailList>
              {goods ? (
                <ContractDetailRow
                  id={TRADE_SECTIONS.exchange}
                  label="Exchange"
                  summary={`${goods.yours.length} for ${goods.theirs.length}${
                    goods.cashAmountCents > 0
                      ? ` plus ${formatAud(goods.cashAmountCents)} cash`
                      : ''
                  }`}
                >
                  <ContractExchangePanel
                    sides={[
                      {
                        heading: 'You give',
                        partyName: me?.name,
                        party: me
                          ? toContractParty(me, yoursValueCents)
                          : null,
                        items: toExchangeItems(goods.yours),
                        isMine: true,
                        cashCents:
                          goods.cashDirection === 'outgoing'
                            ? goods.cashAmountCents
                            : null,
                        cashLabel: `You also pay ${formatAud(goods.cashAmountCents)} through Pinch Payments`,
                        emptyLabel: 'You are putting up no goods.',
                      },
                      {
                        heading: 'You receive',
                        partyName: them?.name,
                        party: them
                          ? toContractParty(them, theirsValueCents)
                          : null,
                        items: toExchangeItems(goods.theirs),
                        cashCents:
                          goods.cashDirection === 'incoming'
                            ? goods.cashAmountCents
                            : null,
                        cashLabel: `You also receive ${formatAud(goods.cashAmountCents)} in cash`,
                        emptyLabel: 'They are putting up no goods.',
                      },
                    ]}
                    footnote="The bundle and cash were fixed when the trade proposal was accepted, so neither side can change them here."
                  />
                </ContractDetailRow>
              ) : null}

              {trade ? (
                <TradeTermsRow trade={trade} viewerRole={viewerRole} />
              ) : null}

              {/* Same section set and order as the deal room: Exchange, Terms,
                  Money, Collateral. */}
              {goods ? (
                <ContractDetailRow
                  id={TRADE_SECTIONS.money}
                  label="Pinch Payments"
                  summary={
                    goods.cashAmountCents > 0
                      ? `${formatAud(goods.cashAmountCents)} cash ${
                          goods.cashDirection === 'outgoing' ? 'from you' : 'to you'
                        }`
                      : 'No cash — goods for goods'
                  }
                  contentClassName="space-y-3"
                >
                  {goods.cashAmountCents > 0 ? (
                    <ContractMoneyTable
                      ariaLabel="Money terms"
                      rows={[
                        {
                          label: 'Cash amount',
                          value: formatAud(goods.cashAmountCents),
                        },
                        {
                          label:
                            goods.cashDirection === 'outgoing'
                              ? 'You pay via Pinch Payments'
                              : `${theirName} pays you via Pinch Payments`,
                          value: formatAud(goods.cashAmountCents),
                          total: true,
                        },
                      ]}
                    />
                  ) : (
                    <p className="text-muted-foreground">
                      No cash component — this trade is goods for goods.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    The cash was fixed when the proposal was accepted. Pinch Payments
                    settles it once the trade completes, so the receiver needs payout
                    details on file.
                  </p>
                </ContractDetailRow>
              ) : null}

              <ContractDetailRow
                id={TRADE_SECTIONS.collateral}
                label="Collateral"
                explainer="A temporary hold when a trader isn't DittoShield verified. Released when the trade completes; only charged if something goes wrong."
                summary={
                  holds.length === 0
                    ? 'Nothing on the line yet'
                    : `${formatAud(heldCents)} across ${holds.length} hold${
                        holds.length === 1 ? '' : 's'
                      }`
                }
                contentClassName="gap-3"
              >
                <p className="text-muted-foreground">
                  Unverified traders post collateral against the value of what they
                  receive. Verified traders skip that hold. Nothing is charged unless
                  the trade goes wrong.
                </p>
                <HoldStatus
                  holds={holds}
                  initiatorId={initiatorId}
                  counterpartId={counterpartId}
                  viewerRole={viewerRole}
                />
              </ContractDetailRow>

              <ContractDetailRow
                label="History"
                summary={
                  latestEvent
                    ? `${history.length} events · ${latestEvent.event
                        .toLowerCase()
                        .replace(/_/g, ' ')}`
                    : 'Nothing has happened yet'
                }
              >
                <ContractTimeline
                  events={history}
                  myUserId={myUserId}
                  ariaLabel="Trade history"
                />
              </ContractDetailRow>

              {demoPanel ? (
                <ContractDetailRow label="Demo" summary="Fire simulated Pinch webhooks">
                  {demoPanel}
                </ContractDetailRow>
              ) : null}
            </ContractDetailList>
            </ContractLiveRow>
          </>
        )}
      </div>
    </ContractFocusProvider>
  );
}
