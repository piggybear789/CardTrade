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

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import { formatAud, formatContractDateTime, itemImageUrl } from '@/lib/format';
import {
  deliveryNotesFromDetails,
  summarizeHandover,
} from '@/lib/handover/terms';
import {
  getTradeDeliveryAddresses,
  retrySettleTradeCash,
  saveTradeDeliveryAddress,
  syncTradeTracking,
  type TradeAddressView,
} from '@/lib/actions/trades';
import {
  DeliveryAddressPanel,
  InspectionCountdown,
} from '@/components/fulfilment';
import { inspectionHoldRisk } from '@/domain/fulfilment';
import { isTrackingStatusPollingAvailable } from '@/domain/services/tracking';

import { FadeSwap } from '@/components/motion/FadeSwap';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ActionBar } from '@/components/trade/ActionBar';
import { TradeNegotiationPanel } from '@/components/trade/TradeNegotiationPanel';
import { HoldStatus } from '@/components/trade/HoldStatus';
import { TRADE_FEE_BPS, tradeFeeCentsFor } from '@/domain/trade/tradeFee';
import { resolveTradeSideValues } from '@/domain/trade/tradeSideValues';
import { ShippingDeadline } from '@/components/trade/ShippingDeadline';
import { StateBadge } from '@/components/trade/StateBadge';
import { TradeHandoverTermsEditor } from '@/components/trade/TradeHandoverTermsEditor';
import { ReportDialog } from '@/components/reports/ReportDialog';
import { PlaceMap } from '@/components/location';
import {
  ContractActionCard,
  ContractConversationPanel,
  ContractDetailList,
  ContractDetailRow,
  DittoBondExplainer,
  ContractExchangePanel,
  ContractFocusProvider,
  ContractHeader,
  ContractLiveRow,
  ContractMoneyTable,
  ContractPartyLine,
  ContractTimeline,
  DisputeEvidencePanel,
  useContractConversation,
  useContractFocus,
  type ContractActionTone,
  type ContractEvent,
  type ContractExchangeItem,
  type ContractParty,
} from '@/components/contract';
import { CounterpartyIdentity } from '@/components/identity/CounterpartyIdentity';
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
import type { DisputeEvidenceEntry } from '@/lib/actions/disputeEvidence';

/**
 * Derive the aggregate TradeFacts snapshot the state machine needs from the live trade
 * row + holds. Mirrors the server-side derivation (which lives in a server-only module)
 * so it can run in the browser. Shipment/receipt/acceptance legs come from the
 * per-trader timestamps; hold activity from the live holds; the terms legs from each
 * side's accepted version against the current one, so a counter-offer clears both.
 *
 * Keep this in step with `factsFromTrade` in `lib/actions/tradeLifecycleStore.ts`. The
 * duplication exists because that module is `server-only`, not because the two are
 * allowed to disagree.
 */
function deriveFacts(
  trade: TradeRow,
  holds: { trader_id: string; status: string }[],
): TradeFacts {
  const holdActive = (traderId: string) =>
    holds.some((h) => h.trader_id === traderId && h.status === 'ACTIVE');
  return {
    termsAccepted: {
      initiator: trade.initiator_terms_accepted_version === trade.terms_version,
      counterpart: trade.counterpart_terms_accepted_version === trade.terms_version,
    },
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
    handoverConfirmed: {
      initiator: trade.initiator_handover_confirmed_at != null,
      counterpart: trade.counterpart_handover_confirmed_at != null,
    },
    fulfilmentMethod: trade.handover_method,
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

/**
 * One item on either side of the agreed swap.
 *
 * `isShopfront` is load-bearing for money, not presentation: a binder's `fmvCents`
 * is an indicative "from" price for a whole inventory, so it must never be summed
 * into a side value. See `resolveTradeSideValues`.
 */
export interface TradeGood {
  id: string;
  title: string;
  fmvCents: number;
  imagePath: string | null;
  /** The listing is a binder or bulk lot (0064), so `fmvCents` is a "from" price. */
  isShopfront?: boolean;
}

/** What each side agreed to hand over, resolved on the server. */
export interface TradeGoods {
  yours: TradeGood[];
  theirs: TradeGood[];
  cashAmountCents: number;
  /** Whether the viewer pays the cash or receives it. */
  cashDirection: 'incoming' | 'outgoing';
}

/** Summed `fmvCents` of one side, before the binder rule is applied. */
function sideGoodsCents(items: TradeGood[]): number {
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
  /** Avatar object path, or null. A PATH, not a URL. */
  avatarPath?: string | null;
  verified: boolean;
  rating: number | null;
  ratingCount: number;
  /** Optional social media handles keyed by platform slug (0085). */
  socialLinks?: Record<string, string> | null;
}

/**
 * Map a trader into the shared contract party shape. A trade is symmetric, so both sides
 * carry the same role label and the same kind of exposure.
 */
function toContractParty(party: TradeParty): ContractParty {
  return {
    name: party.name,
    avatarPath: party.avatarPath ?? null,
    roleLabel: 'Trader',
    verified: party.verified,
    rating: party.rating,
    ratingCount: party.ratingCount,
    socialLinks: party.socialLinks,
    // No value stat. Each side's value was appearing three times over: in the
    // header's `money` line, in this chip, and again on every item row beneath it.
    // The item rows are the authoritative place — they attribute value to the thing
    // that has it — so the trust line carries trust only.
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
  /**
   * Participant evidence on file, when this trade is DISPUTED (0082).
   *
   * Loaded by the page rather than fetched here — see the matching note on
   * `CashSaleViewProps`.
   */
  disputeEvidence?: DisputeEvidenceEntry[];
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
    <div className="rounded-lg border border-dashed border-gold/40 bg-gold/10 px-group py-cozy text-body">
      {pendingAfterComplete ? (
        <>
          <p className="font-medium">
            {iReceive
              ? `${amount} cash is waiting on your payout setup`
              : `${amount} cash is waiting on their payout setup`}
          </p>
          <p className="mt-1 text-muted-foreground">
            {iReceive
              ? // Says PAYOUT SETUP, not "DittoShield". That brand names the identity
                // check, which since 0069 is a different step — and one this member
                // has already passed, or they could not have entered the trade.
                'Finish payout setup so Stripe can pay the cash into your account, then retry.'
              : 'They need to finish payout setup before Stripe can move the cash. You can retry once they have.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {iReceive ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/profile?tab=payouts">Set up payouts</Link>
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
            You can keep trading — collateral covers the goods. Stripe
            moves the cash once the receiver can take payouts.
          </p>
          {iReceive ? (
            <Button asChild size="sm" variant="outline" className="mt-3">
              <Link href="/profile?tab=payouts">Set up payouts</Link>
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
    (trade.state === 'NEGOTIATING' ||
      trade.state === 'COLLATERAL_PENDING' ||
      trade.state === 'COLLATERAL_LOCKED') &&
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

/**
 * Ask the carrier where both parcels are.
 *
 * Only rendered when the configured tracking binding can actually poll. The manual
 * provider cannot, by design, so this is invisible today and lights up for both the
 * trade room and the cash sale room the moment a real carrier integration lands.
 */
function TradeTrackingRefresh({ tradeId }: { tradeId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      aria-busy={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await syncTradeTracking(tradeId);
          if (!result.ok) {
            toast.error(
              result.detail ?? 'Tracking could not be refreshed right now.',
            );
            return;
          }
          toast.success(
            result.delivered
              ? 'Carrier confirmed a delivery.'
              : 'Tracking refreshed.',
          );
        });
      }}
    >
      {isPending ? 'Checking…' : 'Refresh tracking'}
    </Button>
  );
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
  addresses,
  counterpartName,
}: {
  trade: TradeRow;
  viewerRole: TradeViewerRole;
  /** Postal addresses the viewer is entitled to see. Posted trades only. */
  addresses: TradeAddressView;
  counterpartName: string;
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
              precision="exact"
              heightClassName="h-56"
            />
          ) : null}
          {/* Refresh both parcels from the carrier. A carrier-confirmed delivery is
              the only thing that starts the inspection clock — a trader's own word
              records receipt but never starts a clock that can end in a payout
              against them. Renders nothing until a carrier binding that can poll is
              configured; the manual provider deliberately cannot. */}
          {trade.handover_method === 'DELIVERY' &&
          trade.state === 'IN_TRANSIT' &&
          isTrackingStatusPollingAvailable() ? (
            <TradeTrackingRefresh tradeId={trade.id} />
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
      {/* Where each parcel is actually going. A posted trade previously had no
          address of record at all, so traders swapped them in the chat thread —
          outside the contract and outside RLS. Two panels, because a swap posts
          in both directions.
          IMPORTANT: Rendered outside the areHandoverDetailsFilled gate (F40) — the
          address must be settable BEFORE delivery cost is agreed, since you need to
          know where to send it to price postage. The old placement inside the "filled"
          branch made it unreachable when delivery_cost_cents was null. */}
      {trade.handover_method === 'DELIVERY' ? (
        <DeliveryAddressPanel
          mine={addresses.mine}
          theirs={addresses.theirs}
          theirsPending={
            addresses.theirs
              ? null
              : trade.state === 'NEGOTIATING' ||
                  trade.state === 'COLLATERAL_PENDING'
                ? 'Shared with you once collateral is locked on both sides.'
                : 'Not added yet. They need to add an address before you can post.'
          }
          counterpartName={counterpartName}
          editable={editable}
          onSave={async (address) => {
            const result = await saveTradeDeliveryAddress(trade.id, address);
            return result.ok
              ? { ok: true as const }
              : {
                  ok: false as const,
                  message:
                    result.detail ??
                    'Could not save the address. Please try again.',
                };
          }}
        />
      ) : null}
      {editable ? (
        <p className="text-body text-muted-foreground">
          Either trader can update meeting or postage details. That does not
          ask anyone to confirm again. The listing owner sets the cash.
        </p>
      ) : null}
    </ContractDetailRow>
  );
}

/**
 * The live Trade Contract view. Bootstrapped with the participants + viewer role from
 * the server; all live state comes from the realtime hook.
 *
 * SPLIT FROM ITS PROVIDER, matching `CashSaleView`. The room used to render
 * `ContractFocusProvider` itself, which meant anything in this component calling
 * `useContractFocus` read the default context instead of the provider's — and that
 * default is a deliberate no-op, so a focus button would have compiled, rendered, and
 * silently done nothing. The provider has to sit ABOVE the consumer.
 */
export function TradeContract(props: TradeContractProps) {
  return (
    <ContractFocusProvider>
      <TradeContractRoom {...props} />
    </ContractFocusProvider>
  );
}

function TradeContractRoom({
  tradeId,
  initiatorId,
  counterpartId,
  viewerRole,
  goods,
  participants,
  cashReceiverPayoutReady = true,
  demoPanel,
  disputeEvidence = [],
}: TradeContractProps) {
  const { focusSection } = useContractFocus();
  const { trade, holds, transitions, connectionStatus } =
    useTradeRealtime(tradeId);

  const viewer = useMemo<TradeViewerContext | null>(() => {
    if (!trade) return null;
    return { role: viewerRole, facts: deriveFacts(trade, holds) };
  }, [trade, holds, viewerRole]);

  // Postal addresses are NOT on the trade row — that row is Realtime-published, and
  // an address has no business being broadcast. They are read through the
  // cookie-bound client so RLS decides disclosure, which means re-reading when the
  // state changes: the counterpart's address becomes visible at COLLATERAL_LOCKED,
  // and a realtime state change alone would not fetch it.
  const [addresses, setAddresses] = useState<TradeAddressView>({
    mine: null,
    theirs: null,
  });
  const isDeliveryTrade = trade?.handover_method === 'DELIVERY';
  const tradeState = trade?.state;

  const refreshAddresses = useCallback(async () => {
    if (!tradeId) return;
    const next = await getTradeDeliveryAddresses(tradeId);
    setAddresses(next);
  }, [tradeId]);

  useEffect(() => {
    if (!isDeliveryTrade) return;
    void refreshAddresses();
    // `tradeState` is a dependency on purpose: entering COLLATERAL_LOCKED is what
    // unlocks the counterpart's address.
  }, [isDeliveryTrade, tradeState, refreshAddresses]);

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

  // The SAME rule that sizes the collateral and the charged fee. Disclosure has to
  // agree with the charge — that is the point of disclosing before charging — so this
  // reads the shared definition rather than summing the two sides itself. On a binder
  // trade the two sides are equal by construction, which is what the room says.
  const viewerIsInitiator = viewerRole === 'INITIATOR';
  const disclosedSides = resolveTradeSideValues({
    initiatorGoodsCents: sideGoodsCents(
      (viewerIsInitiator ? goods?.yours : goods?.theirs) ?? [],
    ),
    counterpartGoodsCents: sideGoodsCents(
      (viewerIsInitiator ? goods?.theirs : goods?.yours) ?? [],
    ),
    counterpartIsShopfront: ((viewerIsInitiator ? goods?.theirs : goods?.yours) ?? []).some(
      (item) => item.isShopfront,
    ),
  });
  const yoursValueCents = viewerIsInitiator
    ? disclosedSides.initiatorSideCents
    : disclosedSides.counterpartSideCents;
  const theirsValueCents = viewerIsInitiator
    ? disclosedSides.counterpartSideCents
    : disclosedSides.initiatorSideCents;

  // Each trader's fee is 5% of what THEY receive, so the viewer's own fee is sized
  // from the other side's bundle plus any cash coming to them. Derived here rather
  // than read from `trade_fees`, because the fee has to be disclosed BEFORE it is
  // charged — the row does not exist until both sides have accepted.
  const cashCents = goods?.cashAmountCents ?? 0;
  const cashToMe = goods?.cashDirection === 'incoming' ? cashCents : 0;
  const cashToThem = goods?.cashDirection === 'outgoing' ? cashCents : 0;
  const myFeeCents = tradeFeeCentsFor(theirsValueCents + cashToMe);
  const theirFeeCents = tradeFeeCentsFor(yoursValueCents + cashToThem);
  const heldCents = holds.reduce((sum, hold) => sum + hold.amount_cents, 0);

  // The soonest authorisation to lapse across both traders' collateral. If it falls
  // before the inspection deadline, the window outlives the thing backing it and the
  // room says so — silently shortening the window would remove a stated right, and
  // extending it would promise a guarantee the provider has already released.
  const earliestHoldExpiry = holds.reduce<string | null>((soonest, hold) => {
    if (hold.status !== 'ACTIVE' || !hold.expires_at) return soonest;
    if (!soonest) return hold.expires_at;
    return hold.expires_at < soonest ? hold.expires_at : soonest;
  }, null);
  const history = toContractEvents(transitions);
  const latestEvent = history.length > 0 ? history[history.length - 1] : null;

  const steps =
    trade && viewer
      ? deriveTradeSteps({
          state: trade.state,
          viewerRole,
          facts: viewer.facts,
          counterpartyName: theirName,
          addresses:
            trade.handover_method === 'DELIVERY'
              ? {
                  mine:
                    viewerRole === 'INITIATOR'
                      ? trade.initiator_delivery_address_configured
                      : trade.counterpart_delivery_address_configured,
                  theirs:
                    viewerRole === 'INITIATOR'
                      ? trade.counterpart_delivery_address_configured
                      : trade.initiator_delivery_address_configured,
                }
              : undefined,
        })
      : [];
  const step = currentStep(steps);

  return (
    <>
      {/* Height budget for the room, declared once — see the note in
          CashSaleView for the 8.25rem breakdown (4rem header + 4.25rem section
          padding, because `lg:pb-10` overrides `lg:py-7`'s bottom). At `lg` this
          is exactly the shell content box, so the header, action card and
          details/chat row divide it and the panes scroll internally instead of
          growing the page (F37). */}
      <div className="flex min-h-0 flex-1 flex-col gap-group lg:h-[calc(100dvh-8.25rem-1px-env(safe-area-inset-top))] lg:flex-none">
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
                me={toContractParty(me)}
                them={toContractParty(them)}
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

            {/* The inspection clock. A deadline that exists but is never shown is a
                trap, and until 0057 a trade had no deadline at all: an unresponsive
                counterpart parked both traders' collateral until the card
                authorisation lapsed, which removes the guarantee rather than
                resolving anything. */}
            {trade.state === 'INSPECTION' ? (
              <InspectionCountdown
                deadlineAt={trade.inspection_deadline_at}
                viewerMustAct={
                  !(viewerRole === 'INITIATOR'
                    ? trade.initiator_accepted_at
                    : trade.counterpart_accepted_at)
                }
                holdRisk={inspectionHoldRisk(
                  trade.inspection_deadline_at,
                  earliestHoldExpiry,
                )}
                expiryConsequence="If neither of you acts, the trade completes on its own and both collateral holds are released."
              />
            ) : null}

            <ContractLiveRow
              conversation={
                <ContractConversationPanel
                  conversationId={chat.conversationId}
                  currentUserId={myUserId}
                  counterpartyName={theirName}
                  counterpartyAvatarPath={them?.avatarPath}
                  subject={{
                    title: (goods?.yours[0] ?? goods?.theirs[0])?.title ?? '2-way trade',
                    thumb: itemImageUrl(
                      (goods?.yours[0] ?? goods?.theirs[0])?.imagePath ?? null,
                    ),
                    price: goods
                      ? `${formatAud(yoursValueCents)} ⇄ ${formatAud(theirsValueCents)}`
                      : null,
                  }}
                  placeholder="Message about the trade…"
                  emptyHint="Use chat to coordinate shipping and receipt."
                  failed={chat.failed}
                  onRetry={chat.retry}
                  actions={
                    <FadeSwap id={`${trade.state}:${step?.id ?? 'complete'}`}>
                    <ContractActionCard
                      appearance="header"
                      step={step}
                      tone={STATE_TONE[trade.state]}
                      more={
                        trade.state !== 'NEGOTIATING' ? (
                          <ReportDialog
                            targetType="user"
                            targetId={
                              viewerRole === 'INITIATOR' ? counterpartId : initiatorId
                            }
                            triggerLabel={`Report ${theirName}`}
                          />
                        ) : null
                      }
                    >
                      {viewer && trade.state === 'NEGOTIATING' ? (
                        <TradeNegotiationPanel
                          tradeId={tradeId}
                          viewer={viewer}
                          counterpartyId={
                            viewerRole === 'INITIATOR' ? counterpartId : initiatorId
                          }
                          counterpartyName={theirName}
                          termsVersion={trade.terms_version}
                          terms={{
                            cashAmountCents: trade.cash_amount_cents,
                            cashDirection: trade.cash_direction,
                            handoverMethod: trade.handover_method,
                            meetingLocation: trade.meeting_location,
                            meetingLat: trade.meeting_lat,
                            meetingLng: trade.meeting_lng,
                            meetingPlaceId: trade.meeting_place_id,
                            meetingAt: trade.meeting_at,
                            deliveryDetails: trade.delivery_details,
                            deliveryCostCents: trade.delivery_cost_cents,
                            offerMessage: trade.offer_message,
                            counterpartGoodsDescription: trade.counterpart_goods_description,
                          }}
                        />
                      ) : null}

                      {viewer && trade.state !== 'NEGOTIATING' && permittedActionCount > 0 ? (
                        <ActionBar
                          tradeId={tradeId}
                          state={trade.state}
                          viewer={viewer}
                          handoverMethod={trade.handover_method}
                          counterpartName={them?.name}
                          // Nobody should be posting a card to an address they do not
                          // have. The shipment dialog says so rather than failing later.
                          recipientAddressKnown={
                            trade.handover_method !== 'DELIVERY' ||
                            addresses.theirs !== null
                          }
                        />
                      ) : null}

                      {/* BOTH TRADERS GET A WAY IN — see the matching note in
                          CashSaleView. In DISPUTED the ActionBar offers only "Report
                          fraud", which is an escalation, so without this the accused
                          trader's only visible control was to counter-accuse. */}
                      {trade.state === 'DISPUTED' ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => focusSection(TRADE_SECTIONS.dispute)}
                        >
                          <ShieldAlert aria-hidden />
                          {trade.dispute_raised_by === myUserId
                            ? 'Review the dispute'
                            : 'Respond to the dispute'}
                        </Button>
                      ) : null}

                      {trade.state === 'FRAUD_RESOLVED' ? (
                        <p className="text-body text-muted-foreground">
                          The other trader&apos;s deposit was paid to you.
                        </p>
                      ) : null}
                    </ContractActionCard>
                    </FadeSwap>
                  }
                />
              }
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
                  {/* On a binder trade the listing on the other side is an
                      inventory, not the goods — so the panel below would show a
                      binder title and a "from" price where the actual cards belong.
                      This is the statement of what changes hands, it is part of the
                      terms, and it is what an arbitrator reads. */}
                  {trade.counterpart_goods_description ? (
                    <div className="mb-cozy space-y-snug text-body">
                      <p className="font-medium">
                        {viewerRole === 'INITIATOR'
                          ? 'Cards you are getting from their listing'
                          : 'Cards you are giving from your listing'}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-pretty text-muted-foreground">
                        {trade.counterpart_goods_description}
                      </p>
                      <p className="text-body text-muted-foreground">
                        The listing is a binder or bulk lot, so nothing in it is held.
                        This description is what the two of you agreed to swap.
                      </p>
                    </div>
                  ) : null}

                  <CounterpartyIdentity
                    counterpartyId={viewerRole === 'INITIATOR' ? counterpartId : initiatorId}
                    displayName={them?.name}
                  />
                  <ContractExchangePanel
                    sides={[
                      {
                        heading: 'You give',
                        partyName: me?.name,
                        party: me
                          ? toContractParty(me)
                          : null,
                        items: toExchangeItems(goods.yours),
                        isMine: true,
                        cashCents:
                          goods.cashDirection === 'outgoing'
                            ? goods.cashAmountCents
                            : null,
                        // Description only: the amount is the ledger row's right
                        // column, so repeating it in the label would print it twice
                        // on one line.
                        cashLabel: 'Cash you pay via Stripe',
                        // Disclosed on the side that PAYS it, sized on what that
                        // trader receives — so it appears against your column while
                        // being derived from theirs.
                        feeCents: myFeeCents,
                        feeLabel: `NoDitto fee (${TRADE_FEE_BPS / 100}%)`,
                        emptyLabel: 'You are putting up no goods.',
                      },
                      {
                        heading: 'You receive',
                        partyName: them?.name,
                        party: them
                          ? toContractParty(them)
                          : null,
                        items: toExchangeItems(goods.theirs),
                        cashCents:
                          goods.cashDirection === 'incoming'
                            ? goods.cashAmountCents
                            : null,
                        // This column is what THEY give, so it reads from their side
                        // even though the heading is relational. Framing it as "you
                        // receive" would put a credit in a column of debits.
                        cashLabel: 'Cash they pay via Stripe',
                        feeCents: theirFeeCents,
                        feeLabel: `NoDitto fee (${TRADE_FEE_BPS / 100}%)`,
                        emptyLabel: 'They are putting up no goods.',
                      },
                    ]}
                    footnote={
                      trade.state === 'NEGOTIATING'
                        ? 'Either of you can still counter these terms. Nothing is held until you both accept the same version.'
                        : 'The bundle and cash were fixed when both of you accepted the terms, so neither side can change them now.'
                    }
                  />
                </ContractDetailRow>
              ) : null}

              {/* Dispatch clock for posted trades. Renders nothing for
                  IN_PERSON, which has no deadline and never races the ~7-day
                  collateral authorisation window. */}
              {trade ? (
                <ShippingDeadline
                  deadlineAt={trade.shipping_deadline_at}
                  overdueAt={trade.shipping_overdue_at}
                  viewerShipped={Boolean(
                    viewerRole === 'INITIATOR'
                      ? trade.initiator_shipped_at
                      : trade.counterpart_shipped_at,
                  )}
                  counterpartShipped={Boolean(
                    viewerRole === 'INITIATOR'
                      ? trade.counterpart_shipped_at
                      : trade.initiator_shipped_at,
                  )}
                  className="mb-3"
                />
              ) : null}

              {/* CALLED, NOT RENDERED — and that is the fix, not a style choice.
                  `ContractDetailList` selects its rows with
                  `child.type === ContractDetailRow`, so `<TradeTermsRow />` (whose type
                  is `TradeTermsRow`) was silently discarded and this entire tab
                  disappeared, taking the delivery-address panel with it. A posted trade
                  past collateral then demanded an address it gave no way to add.
                  Invoking the helper makes the child the `ContractDetailRow` it
                  returns. `ContractDetailList` now also logs anything it drops. */}
              {trade
                ? TradeTermsRow({
                    trade,
                    viewerRole,
                    addresses,
                    counterpartName: theirName,
                  })
                : null}

              {/* Same section set and order as the deal room: Exchange, Terms,
                  Money, Collateral. */}
              {goods ? (
                <ContractDetailRow
                  id={TRADE_SECTIONS.money}
                  label="Payment"
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
                              ? 'You pay via Stripe'
                              : `${theirName} pays you via Stripe`,
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
                  <p className="text-body text-muted-foreground">
                    The cash was fixed when the proposal was accepted. Stripe
                    settles it once the trade completes, so the receiver needs payout
                    details on file.
                  </p>
                </ContractDetailRow>
              ) : null}

              <ContractDetailRow
                id={TRADE_SECTIONS.collateral}
                label="Collateral"
                explainer="Trade collateral is a temporary card authorisation each trader places against the agreed value. It is released after normal completion; it is not a payment."
                summary={
                  holds.length === 0
                    ? 'Nothing on the line yet'
                    : `${formatAud(heldCents)} across ${holds.length} hold${
                        holds.length === 1 ? '' : 's'
                      }`
                }
                contentClassName="gap-3"
              >
                {/* Both traders bond now — the verified exemption is gone, because it
                    left every trade with no collateral and made a dispute or fraud
                    finding unpayable. See `domain/bond/bondPolicy.ts`. */}
                <DittoBondExplainer />
                <HoldStatus
                  holds={holds}
                  initiatorId={initiatorId}
                  counterpartId={counterpartId}
                  viewerRole={viewerRole}
                />
              </ContractDetailRow>

              {/* Dispute evidence (0082). Only while disputed or resolved — see the
                  matching note in CashSaleView. */}
              {trade && (trade.state === 'DISPUTED' || trade.state === 'FRAUD_RESOLVED') ? (
                <ContractDetailRow
                  id={TRADE_SECTIONS.dispute}
                  label="Dispute"
                  variant="destructive"
                  explainer="Your account of what happened, with photos or video. Both traders can see everything here, and so can the staff member deciding it."
                  summary={
                    disputeEvidence.length > 0
                      ? `${disputeEvidence.length} submission${disputeEvidence.length === 1 ? '' : 's'}`
                      : 'Nothing submitted yet'
                  }
                >
                  <DisputeEvidencePanel
                    caseKind="TRADE"
                    caseRef={trade.id}
                    entries={disputeEvidence}
                    disputeReason={trade.dispute_reason}
                    raisedByName={
                      trade.dispute_raised_by
                        ? trade.dispute_raised_by === myUserId
                          ? 'you'
                          : theirName
                        : null
                    }
                    canSubmit={trade.state === 'DISPUTED'}
                  />
                </ContractDetailRow>
              ) : null}

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
                <ContractDetailRow label="Demo" summary="Fire simulated Stripe webhooks">
                  {demoPanel}
                </ContractDetailRow>
              ) : null}
            </ContractDetailList>
            </ContractLiveRow>
          </>
        )}
      </div>
    </>
  );
}
