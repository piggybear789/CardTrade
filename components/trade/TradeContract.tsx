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
  FulfilmentMethodSummary,
  InspectionCountdown,
} from '@/components/fulfilment';
import { inspectionHoldRisk } from '@/domain/fulfilment';
import { isTrackingStatusPollingAvailable } from '@/domain/services/tracking';

import { DesktopOnly } from '@/components/layout/Breakpoint';
import { FadeSwap } from '@/components/motion/FadeSwap';
import { Button } from '@/components/ui/button';
import { ActionBar } from '@/components/trade/ActionBar';
import { TradeNegotiationPanel } from '@/components/trade/TradeNegotiationPanel';
import { HoldStatus } from '@/components/trade/HoldStatus';
import {
  SavedCardRow,
  type SavedCardStatus,
} from '@/components/payments/SavedCardRow';
import { TRADE_FEE_BPS, tradeFeeCentsFor } from '@/domain/trade/tradeFee';
import {
  resolveTradeSideValues,
  tradeAgreedValueCents,
} from '@/domain/trade/tradeSideValues';
import { ShippingDeadline } from '@/components/trade/ShippingDeadline';
import { StateBadge, TRADE_STATUS_MAP } from '@/components/trade/StateBadge';
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
  ContractProgressRail,
  ContractTimeline,
  DisputeEvidencePanel,
  useContractConversation,
  useContractFocus,
  type ContractActionTone,
  type ContractEvent,
  type ContractExchangeItem,
  type ContractParty,
} from '@/components/contract';
import {
  TRADE_SECTIONS,
  currentStep,
  derivePostageSteps,
  deriveTradeSteps,
  type ContractStep,
} from '@/domain/contract';
import { ensureTradeConversation } from '@/lib/actions/trades';
import { availableActions } from '@/domain/state-machine/actions';
import {
  useTradeRealtime,
  type TradeRealtimeSeed,
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
  holds: { trader_id: string; status: string; created_at?: string }[],
): TradeFacts {
  const latestStatus = (traderId: string) => {
    const theirs = holds
      .filter((h) => h.trader_id === traderId)
      .toSorted((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
    return theirs[theirs.length - 1]?.status;
  };
  const initiatorStatus = latestStatus(trade.initiator_id);
  const counterpartStatus = latestStatus(trade.counterpart_id);
  const seekEnded = (status: string | undefined) =>
    status === 'FAILED' || status === 'VOIDED' || status === 'EXPIRED';
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
      initiator: initiatorStatus === 'ACTIVE',
      counterpart: counterpartStatus === 'ACTIVE',
    },
    collateralSeekFailed: seekEnded(initiatorStatus) || seekEnded(counterpartStatus),
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

/**
 * Name what is travelling in one direction, for a delivery lane.
 *
 * Titles rather than a count: "Pikachu · 2016 Evolutions" tells the reader which
 * parcel this lane is about, where "1 item" tells them nothing they did not
 * already know from the fact that a lane exists.
 */
function parcelLabel(items: TradeGood[] | undefined): string | null {
  if (!items || items.length === 0) return null;
  if (items.length <= 2) return items.map((item) => item.title).join(' · ');
  return `${items[0].title} and ${items.length - 1} more`;
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
  /**
   * The trade, its holds and its transition history as the server rendered them.
   *
   * The room paints from these immediately and swaps to live rows when the
   * Realtime channel connects. Without a seed the body waited on a client fetch,
   * so the server's work produced HTML with no contract in it.
   */
  seed?: TradeRealtimeSeed;
  /** The agreed goods and cash, so both traders can see the whole deal. */
  goods?: TradeGoods;
  /** Compact reputation context for both traders, resolved on the server. */
  participants?: { initiator: TradeParty; counterpart: TradeParty };
  /**
   * The viewer's saved card as the server already knew it. Seeds every
   * `SavedCardRow` in the room so the card block does not grow in under the
   * accept controls a moment after they paint.
   */
  paymentMethod?: SavedCardStatus | null;
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
  /**
   * The review affordance for a finished trade — the "Leave a review" trigger,
   * or a marker saying one has already been left.
   *
   * A SLOT, because whether a review exists is a server read and this view is a
   * client component. It renders inside the action card rather than as a strip
   * under the room: on a completed trade "rate this" IS the next thing to do, so
   * it belongs in the one place that answers that question.
   */
  reviewAction?: ReactNode;
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
    <div className="rounded-lg border border-dashed border-iris/40 bg-iris/10 px-group py-cozy text-body">
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

/**
 * WHERE ARE THE PARCELS — the posted trade's four-step plan, then the controls for
 * whichever step is live.
 *
 * ONE CARD, AND ALMOST NO PROSE. This briefly grew a "Now: before posting — step 1
 * of 4" header and a "What happens next" list underneath, and the three of them
 * said the same thing three ways: the rail marks the live step, the header named
 * it, and the list restated every step the rail had already drawn. The rail's
 * captions carry the sequence; the lanes below say whose move it is. Each step's
 * full sentence is still one tap away on its own tick.
 */
function TradePostagePlan({
  steps,
  deadline,
  children,
}: {
  steps: ContractStep[];
  /**
   * The dispatch clock, hung off the step it constrains.
   *
   * It used to be a full-width banner above the plan, where the deadline and the
   * step it is a deadline FOR were two unrelated blocks — the reader had to work
   * out that "post within 9 days" was about the second tick.
   */
  deadline?: ReactNode;
  /** The live step's own controls — the address lanes and tracking. */
  children: ReactNode;
}) {
  return (
    <section className="space-y-group rounded-xl border bg-card p-group">
      <ContractProgressRail
        steps={steps}
        numbered
        captions
        annotations={deadline ? { 'postage-posted': deadline } : undefined}
      />
      {children}
    </section>
  );
}

/** Terms row — meeting / delivery, editable until first ship. */
function TradeTermsRow({
  trade,
  viewerRole,
  addresses,
  counterpartName,
  postageSteps,
  mineParcel,
  theirsParcel,
  deadline,
}: {
  trade: TradeRow;
  viewerRole: TradeViewerRole;
  /** Postal addresses the viewer is entitled to see. Posted trades only. */
  addresses: TradeAddressView;
  counterpartName: string;
  /** The four-step postage plan. Posted trades only. */
  postageSteps?: ContractStep[];
  /** What is coming to the viewer, named on its lane. */
  mineParcel?: string | null;
  /** What the viewer is posting out. */
  theirsParcel?: string | null;
  /**
   * The dispatch clock, when the trade has one.
   *
   * A PROP, because `ContractDetailList` renders only children whose type is
   * `ContractDetailRow` and drops everything else. This was passed as a
   * sibling of the rows, so it was silently discarded on every posted trade —
   * the same class of bug as the one recorded at the `TradeTermsRow` call
   * site, and the reason that list now logs what it drops. It belongs in Terms
   * regardless: the deadline is a term of the handover.
   *
   * Now rendered as a chip on the rail's "Posted" tick rather than as a banner.
   */
  deadline?: ReactNode;
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
      {/* THE AGREED METHOD LEADS. It was stated only in the collapsed tab
          summary, so an open Terms tab showed postage costs and address lanes
          without once saying that posting is what was agreed — and the only way
          to see the alternative was to open the editor. The unchosen option
          stays on screen, quiet, so the decision reads as a decision. */}
      <FulfilmentMethodSummary method={trade.handover_method} />

      {trade.handover_method === null ? (
        <p className="text-muted-foreground">
          Not agreed yet — choose face to face or delivery, then fill in the
          details.
        </p>
      ) : trade.handover_method === 'IN_PERSON' ? (
        !areHandoverDetailsFilled(trade) ? (
          <p className="text-muted-foreground">No meeting place yet.</p>
        ) : (
          <>
            <ContractMoneyTable
              ariaLabel="Meeting terms"
              rows={[
                {
                  label: 'Meeting point',
                  hint: trade.meeting_location,
                  value: '',
                },
                {
                  label: 'When',
                  value:
                    formatContractDateTime(trade.meeting_at) ?? 'Not agreed yet',
                  muted: !trade.meeting_at,
                },
              ]}
            />
            {trade.meeting_lat != null || trade.meeting_location ? (
              <PlaceMap
                lat={trade.meeting_lat}
                lng={trade.meeting_lng}
                label={trade.meeting_location}
                precision="exact"
                heightClassName="h-56"
              />
            ) : null}
          </>
        )
      ) : (
        /* POSTED. The plan owns the tab: the four steps, then the live step's
           controls inside it, then what follows. Everything below used to be a
           flat stack of tables under the deadline, in no particular order and
           with no statement of where the trade had got to.

           The address lanes are deliberately NOT gated on
           `areHandoverDetailsFilled` (F40): an address must be settable before
           the postage cost is agreed, since you need to know where a parcel is
           going to price it. The old gate made the panel unreachable whenever
           `delivery_cost_cents` was null — which is exactly when you need it. */
        <TradePostagePlan steps={postageSteps ?? []} deadline={deadline}>
          {trade.delivery_cost_cents != null ? (
            <ContractMoneyTable
              ariaLabel="Postage terms"
              rows={deliveryTermsRows(trade)}
            />
          ) : null}

          <DeliveryAddressPanel
            mine={addresses.mine}
            theirs={addresses.theirs}
            // Four words. The lane's own chip already names who is being waited
            // on, so this only has to say why the address is not here yet.
            theirsPending={
              addresses.theirs
                ? null
                : trade.state === 'NEGOTIATING' ||
                    trade.state === 'COLLATERAL_PENDING'
                  ? 'Shared once collateral locks.'
                  : 'Not added yet.'
            }
            counterpartName={counterpartName}
            mineParcel={mineParcel}
            theirsParcel={theirsParcel}
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

          {/* Refresh both parcels from the carrier. A carrier-confirmed delivery
              is the only thing that starts the inspection clock — a trader's own
              word records receipt but never starts a clock that can end in a
              payout against them. Renders nothing until a carrier binding that
              can poll is configured; the manual provider deliberately cannot. */}
          {trade.state === 'IN_TRANSIT' && isTrackingStatusPollingAvailable() ? (
            <TradeTrackingRefresh tradeId={trade.id} />
          ) : null}

          {/* Only once something is actually in the post. Two rows both reading
              "Not shipped yet" is a table whose entire content is that it has
              none — and the rail above already says so. */}
          {myTracking !== 'Not shipped yet' ||
          theirTracking !== 'Not shipped yet' ? (
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
        </TradePostagePlan>
      )}
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
  seed,
  goods,
  participants,
  paymentMethod = null,
  cashReceiverPayoutReady = true,
  demoPanel,
  disputeEvidence = [],
  reviewAction,
}: TradeContractProps) {
  const { focusSection } = useContractFocus();
  const { trade, holds, transitions, connectionStatus } = useTradeRealtime(
    tradeId,
    seed,
  );

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

  // What the room HEADLINES. The per-side figures above still size collateral
  // and the fee; they are no longer set against each other as a headline, for
  // the reason in `tradeAgreedValueCents`.
  const agreedValueCents = tradeAgreedValueCents({
    declaredValueCents: trade?.declared_value_cents,
    initiatorSideCents: disclosedSides.initiatorSideCents,
    counterpartSideCents: disclosedSides.counterpartSideCents,
    cashAmountCents: goods?.cashAmountCents ?? 0,
  });

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

  // Whether each trader has an address on the contract, read from the row's own
  // configured flags rather than from `addresses` — the viewer is not entitled to
  // READ the counterparty's address until collateral locks, but they are always
  // entitled to know whether one exists, which is what gates posting.
  const addressLegs = trade
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
    : { mine: false, theirs: false };

  // The postage journey, separate from the contract-wide plan above. See
  // `derivePostageSteps` for why the Terms tab does not reuse `steps`.
  const postageSteps =
    trade && viewer && trade.handover_method === 'DELIVERY'
      ? derivePostageSteps({
          state: trade.state,
          viewerRole,
          facts: viewer.facts,
          counterpartyName: theirName,
          addresses: addressLegs,
          cashLabel: cashToMe > 0 ? formatAud(cashToMe) : null,
        })
      : undefined;

  return (
    <>
      {/* Height budget and the room's own inset, declared once — see the note in
          CashSaleView for the 5rem breakdown and why the frame is painted here
          rather than by the shell. At `lg` this is exactly the shell content
          box, so the header, action card and details/chat row divide it and the
          panes scroll internally instead of growing the page (F37). */}
      <div className="flex min-h-0 flex-1 flex-col gap-group md:px-4 md:pt-4 lg:h-[calc(100dvh-5rem-1px-env(safe-area-inset-top))] lg:flex-none">
        {/* Desktop only. Below `md` the room is a thread, and the chat bar
            already carries this title, value and counterparty — a second copy
            of them was the first 76px of every phone contract. */}
        <DesktopOnly>
          {/* The title names the COUNTERPARTY, not the contract type. "2-way
              trade" described every trade in the product, and plain "Trade"
              printed the same word the rail beside it was already showing. Who
              you are trading with is the one thing that distinguishes this room
              from the next one in the list.

              "2-way Trade" survives as the DOMAIN term in code and comments,
              where it does contrast with a cash sale and a deal. */}
          <ContractHeader
            money={
              goods ? formatAud(agreedValueCents) : undefined
            }
            // A SENTENCE, NOT A DIAGRAM. This was `You ⇄ test`, two avatar chips
            // with shields and a glyph between them, which spent the whole left
            // half of the strip restating something the reader already knows —
            // that they are in this trade — and named the counterparty in the
            // same weight as the word "You". Who you are trading with is the
            // heading. Their verification and rating are on the Exchange cards,
            // beside the goods those figures are meant to qualify.
            title={them ? `Trade with ${them.name}` : 'Trade'}
            status={trade ? <StateBadge state={trade.state} /> : null}
            connectionStatus={connectionStatus}
          />
        </DesktopOnly>

        {/* Seeded from the server, so this is only ever null if the room is
            mounted without one. It used to be null on every open — the hook
            started at `null` and this gate threw away five server queries, so
            the contract did not exist until hydration had finished and a client
            fetch had returned. `app/(workspace)/trades/[id]/loading.tsx` had
            already gone by then, which is what made the room feel like it
            arrived late. */}
        {trade === null ? null : (
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
              detailsTitle="Trade"
              detailsMeta={
                <>
                  <StateBadge state={trade.state} />
                  {goods ? (
                    <span className="display-value text-foreground">
                      {formatAud(agreedValueCents)}
                    </span>
                  ) : null}
                </>
              }
              conversation={
                <ContractConversationPanel
                  conversationId={chat.conversationId}
                  currentUserId={myUserId}
                  counterpartyName={theirName}
                  counterpartyAvatarPath={them?.avatarPath}
                  backHref="/trades"
                  statusLabel={TRADE_STATUS_MAP[trade.state]?.label ?? null}
                  subject={{
                    title: (goods?.yours[0] ?? goods?.theirs[0])?.title ?? 'Trade',
                    thumb: itemImageUrl(
                      (goods?.yours[0] ?? goods?.theirs[0])?.imagePath ?? null,
                    ),
                    price: goods ? formatAud(agreedValueCents) : null,
                  }}
                  placeholder="Message about the trade…"
                  emptyHint="Use chat to coordinate shipping and receipt."
                  failed={chat.failed}
                  onRetry={chat.retry}
                  // Reporting is about the counterparty, so it sits with them
                  // in the subject bar rather than in the action dock, whose
                  // menu is for the contract's current step.
                  menu={
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
                  actions={
                    <FadeSwap id={`${trade.state}:${step?.id ?? 'complete'}`}>
                    <ContractActionCard
                      appearance="dock"
                      step={step}
                      tone={STATE_TONE[trade.state]}
                      // An outcome to read, not a control — it was a paragraph
                      // child, which now lands in the button column.
                      note={
                        trade.state === 'FRAUD_RESOLVED'
                          ? "The other trader's deposit was paid to you."
                          : undefined
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
                          paymentMethod={paymentMethod}
                          liveUpdates={connectionStatus === 'live'}
                        />
                      ) : null}

                      {viewer &&
                      trade.state === 'COLLATERAL_PENDING' &&
                      permittedActionCount === 0 ? (
                        <SavedCardRow
                          initialStatus={paymentMethod}
                          className="w-full sm:max-w-sm"
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
                          paymentMethod={paymentMethod}
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

                          {trade.dispute_raised_by === myUserId
                            ? 'Review the dispute'
                            : 'Respond to the dispute'}
                        </Button>
                      ) : null}

                      {trade.state === 'COMPLETED' ? reviewAction : null}
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

                  {/* No standalone identity disclosure. "You are dealing with
                      <name>" sat above the ledger on every visit to Exchange,
                      restating what each side of that ledger now says for
                      itself with an "Identity verified" line under the trader's
                      name. One banner, permanently, for a fact already on
                      screen twice. */}
                  <ContractExchangePanel
                    sides={[
                      {
                        heading: 'You send',
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
                    // The cash sentence used to be a tab of its own. See the
                    // note where that tab was removed.
                    footnote={
                      <>
                        {trade.state === 'NEGOTIATING'
                          ? 'Either of you can still counter these terms. Nothing is held until you both accept the same version.'
                          : 'The bundle and cash were fixed when both of you accepted the terms, so neither side can change them now.'}
                        {goods.cashAmountCents > 0
                          ? ' Stripe settles the cash once the trade completes, so whoever receives it needs payout details on file.'
                          : null}
                      </>
                    }
                  />
                </ContractDetailRow>
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
                    postageSteps,
                    // The lane TO the viewer carries what they receive, which is
                    // the counterparty's side of the swap — not their own.
                    mineParcel: parcelLabel(goods?.theirs),
                    theirsParcel: parcelLabel(goods?.yours),
                    // Renders nothing for IN_PERSON, which has no deadline and
                    // never races the ~7-day collateral authorisation window.
                    deadline: (
                      <ShippingDeadline
                        compact
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
                      />
                    ),
                  })
                : null}

              {/* NO PAYMENT TAB. It held one figure and said it twice — a
                  "Cash amount" row and a "You pay via Stripe" row printing the
                  same number with two labels — and the Exchange ledger beside
                  it was already showing that cash as a line in the column that
                  pays it. A whole tab, one tap away, to restate the first tab.
                  Its only non-duplicated fact was that Stripe settles on
                  completion and the receiver needs payout details, which is now
                  the second sentence of the Exchange footnote. On a
                  goods-for-goods trade the tab said "No cash component" — a tab
                  whose entire content was that it had none.

                  Sections are now: Exchange, Terms, Collateral, History. */}
              <ContractDetailRow
                id={TRADE_SECTIONS.collateral}
                label="Collateral"
                // One line, and it sets up the table below it. It used to run
                // to two sentences restating what the tab is called, while the
                // fact a reader actually wants — is my money gone? — was three
                // paragraphs further down.
                explainer="A temporary card authorisation, not a payment. Your available balance may dip while the trade runs; nothing is charged unless something goes wrong."
                summary={
                  holds.length === 0
                    ? 'Nothing on the line yet'
                    : `${formatAud(heldCents)} across ${holds.length} hold${
                        holds.length === 1 ? '' : 's'
                      }`
                }
                contentClassName="gap-3"
              >
                {/* THE FACTS BEFORE THE EXPLANATION. This was the other way
                    round, so opening "Collateral" — to find out what is on the
                    line — began with a tutorial and put the actual holds last.
                    Both traders bond now; the verified exemption is gone,
                    because it left every trade with no collateral and made a
                    dispute or fraud finding unpayable. See
                    `domain/bond/bondPolicy.ts`. */}
                <HoldStatus
                  holds={holds}
                  initiatorId={initiatorId}
                  counterpartId={counterpartId}
                  viewerRole={viewerRole}
                />
                <DittoBondExplainer />
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
