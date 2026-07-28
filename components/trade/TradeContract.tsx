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

import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';

import { formatAud, itemImageUrl } from '@/lib/format';

import { Card, CardContent } from '@/components/ui/card';
import { ActionBar } from '@/components/trade/ActionBar';
import { HoldStatus } from '@/components/trade/HoldStatus';
import { StateBadge } from '@/components/trade/StateBadge';
import {
  ContractActionCard,
  ContractConversationPanel,
  ContractDetailList,
  ContractDetailRow,
  ContractExchangePanel,
  ContractFocusProvider,
  ContractHeader,
  ContractLiveRow,
  ContractPartyLine,
  ContractProgressRail,
  useContractConversation,
  type ContractActionTone,
  type ContractExchangeItem,
  type ContractParty,
} from '@/components/contract';
import { TRADE_SECTIONS, currentStep, deriveTradeSteps } from '@/domain/contract';
import { ensureTradeConversation } from '@/lib/actions/trades';
import { availableActions } from '@/domain/state-machine/actions';
import { useTradeRealtime, type TradeRow } from '@/lib/realtime/useTradeRealtime';
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
   * Slot for the Demo panel (task 15.3). The panel is a separate deliverable; this view
   * accepts it as a prop and mounts it in the collapsed detail rows.
   */
  demoPanel?: ReactNode;
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
  demoPanel,
}: TradeContractProps) {
  const { trade, holds, connectionStatus } = useTradeRealtime(tradeId);

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
            <ContractLiveRow
              action={
                <ContractActionCard
                  step={step}
                  counterpartyName={theirName}
                  tone={STATE_TONE[trade.state]}
                >
                  {viewer && permittedActionCount > 0 ? (
                    <ActionBar tradeId={tradeId} state={trade.state} viewer={viewer} />
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
                  label="The swap"
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
                        items: toExchangeItems(goods.yours),
                        isMine: true,
                        cashCents:
                          goods.cashDirection === 'outgoing'
                            ? goods.cashAmountCents
                            : null,
                        cashLabel: `You also pay ${formatAud(goods.cashAmountCents)} in cash`,
                        emptyLabel: 'You are putting up no goods.',
                      },
                      {
                        heading: 'You receive',
                        partyName: them?.name,
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

              <ContractDetailRow
                id={TRADE_SECTIONS.collateral}
                label="Collateral"
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
                  An unverified trader has agreed we can charge their card for the full
                  value of their item. Nothing is charged unless the trade goes wrong.
                </p>
                <HoldStatus
                  holds={holds}
                  initiatorId={initiatorId}
                  counterpartId={counterpartId}
                  viewerRole={viewerRole}
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
