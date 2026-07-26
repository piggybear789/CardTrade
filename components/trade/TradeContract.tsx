'use client';

// components/trade/TradeContract.tsx
//
// The flagship real-time Trade Contract view (Req 11). A Client Component that
// subscribes to the live Trade row + its Pre_Auth_Holds via useTradeRealtime,
// and renders:
//   * the current Trade_State as a badge                              (Req 11.1)
//   * each hold's amount + live status                                (Req 11.1)
//   * only the controls the state machine permits for this viewer     (Req 11.3, 11.4)
//   * a Live / Reconnecting / Offline connection indicator            (Req 11.5)
//   * the outcome once a fraud report has been settled                (Req 8.4)
//
// All updates arrive over the realtime channel, so the view reflects Trade_State
// and hold changes without a page reload (Req 11.2). The viewer context (role +
// derived TradeFacts) is rebuilt from the live trade row each render so the
// ActionBar always reflects current facts.

import { useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck, Star, UserRound, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

import { formatAud, itemImageUrl } from '@/lib/format';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ActionBar } from '@/components/trade/ActionBar';
import { HoldStatus } from '@/components/trade/HoldStatus';
import { StateBadge } from '@/components/trade/StateBadge';
import { ContractChat } from '@/components/messages/ContractChat';
import { ContractWorkspace } from '@/components/layout/ContractWorkspace';
import { ensureTradeConversation } from '@/lib/actions/trades';
import { availableActions } from '@/domain/state-machine/actions';
import {
  useTradeRealtime,
  type ConnectionStatus,
  type TradeRow,
} from '@/lib/realtime/useTradeRealtime';
import type {
  TradeFacts,
  TradeViewerContext,
  TradeViewerRole,
} from '@/domain/state-machine/types';
import type { ReactNode } from 'react';

/**
 * Derive the aggregate TradeFacts snapshot the state machine needs from the live
 * trade row + holds. Mirrors the server-side derivation (which lives in a
 * server-only module) so it can run in the browser. Shipment/receipt/acceptance
 * legs come from the per-trader timestamps; hold activity from the live holds.
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

/** Presentation for the realtime connection indicator (Req 11.5). */
const CONNECTION_INDICATOR: Record<
  ConnectionStatus,
  { label: string; className: string; icon: 'live' | 'reconnecting' | 'offline' }
> = {
  live: {
    label: 'Live',
    className: 'text-emerald-600',
    icon: 'live',
  },
  connecting: {
    label: 'Reconnecting',
    className: 'text-amber-600',
    icon: 'reconnecting',
  },
  reconnecting: {
    label: 'Reconnecting',
    className: 'text-amber-600',
    icon: 'reconnecting',
  },
  error: {
    label: 'Offline',
    className: 'text-destructive',
    icon: 'offline',
  },
};

/** The small Live / Reconnecting / Offline pill (Req 11.5). */
function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const meta = CONNECTION_INDICATOR[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-medium ${meta.className}`}
      role="status"
      aria-live="polite"
      aria-label={`Connection status: ${meta.label}`}
    >
      {meta.icon === 'live' ? (
        <Wifi className="size-4" aria-hidden />
      ) : meta.icon === 'reconnecting' ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <WifiOff className="size-4" aria-hidden />
      )}
      {meta.label}
    </span>
  );
}

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

/** A column of goods, listing every item rather than assuming one per side. */
function GoodsColumn({ heading, items }: { heading: string; items: TradeGood[] }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="market-label text-muted-foreground">{heading}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing recorded.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => {
            const thumb = itemImageUrl(item.imagePath);
            return (
              <li key={item.id} className="flex items-center gap-2.5">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumb}
                    alt=""
                    width={96}
                    height={96}
                    className="size-10 shrink-0 rounded-md object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="size-10 shrink-0 rounded-md bg-muted" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {item.title}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatAud(item.fmvCents)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Reputation summary for one trader, shown in the compact contract workspace. */
export interface TradeParty {
  name: string;
  verified: boolean;
  rating: number | null;
  ratingCount: number;
}

/** One trader's compact card: identity, verification, and feedback (Req 2.4). */
function TraderColumn({
  party,
  isMe,
}: {
  party: TradeParty;
  isMe: boolean;
}) {
  return (
    <Card className={isMe ? 'border-primary/40' : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
          <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{isMe ? 'You' : party.name}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isMe ? (
          <p className="truncate text-xs text-muted-foreground">{party.name}</p>
        ) : null}
        <p
          className={cn(
            'flex items-center gap-1.5 text-xs',
            party.verified
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-amber-700 dark:text-amber-400',
          )}
        >
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          {party.verified ? 'Identity verified (KYC)' : 'Identity not verified'}
        </p>
        <p className="flex items-center gap-1 border-t pt-3 text-xs">
          {party.rating === null ? (
            <span className="text-muted-foreground">No reviews yet</span>
          ) : (
            <>
              <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
              <span className="font-medium">{party.rating.toFixed(1)}</span>
              <span className="text-muted-foreground">({party.ratingCount})</span>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
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
   * Slot for the Demo panel (task 15.3). The panel is a separate deliverable;
   * this view accepts it as a prop and mounts it here when provided.
   */
  demoPanel?: ReactNode;
}

/**
 * The live Trade Contract view. Bootstrapped with the participants + viewer role
 * from the server; all live state comes from the realtime hook.
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
  const [chatId, setChatId] = useState<string | null>(trade?.conversation_id ?? null);
  const [chatError, setChatError] = useState(false);

  const viewer = useMemo<TradeViewerContext | null>(() => {
    if (!trade) return null;
    return { role: viewerRole, facts: deriveFacts(trade, holds) };
  }, [trade, holds, viewerRole]);

  // How many actions the state machine permits the viewer right now - drives the
  // "no actions available" helper text (Req 11.4).
  const permittedActionCount =
    trade && viewer ? availableActions(trade.state, viewer).length : 0;

  // An accepted trade is a contract room just like a Cash_Sale or Deal, so it
  // gets the same participant-only chat. Trades accepted before the thread
  // existed self-heal on first view (demo-contract-ux Req 1, 2).
  useEffect(() => {
    if (!trade) return;
    if (trade.conversation_id) {
      setChatId(trade.conversation_id);
      return;
    }
    let cancelled = false;
    void ensureTradeConversation(trade.id).then((result) => {
      if (cancelled) return;
      if (result.ok) setChatId(result.conversationId);
      else setChatError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [trade?.id, trade?.conversation_id]);

  const me = viewerRole === 'INITIATOR' ? participants?.initiator : participants?.counterpart;
  const them = viewerRole === 'INITIATOR' ? participants?.counterpart : participants?.initiator;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trade contract</h1>
          <p className="text-sm text-muted-foreground">
            Live escrow status for this 2-way trade.
          </p>
        </div>
        <ConnectionIndicator status={connectionStatus} />
      </div>

      {trade === null ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            Loading trade…
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="space-y-1.5">
                  <CardTitle className="text-lg">Escrow status</CardTitle>
                  <CardDescription>
                    The current stage of this trade&apos;s lifecycle.
                  </CardDescription>
                </div>
                <StateBadge state={trade.state} />
              </div>
            </CardHeader>
            <CardContent>
              <ViewerRoleLine role={viewerRole} />
            </CardContent>
          </Card>

          {/* Compact participant summary beside a properly bounded conversation
              panel (demo-contract-ux Req 1, 2). */}
          {me && them ? (
            <ContractWorkspace
              parties={
                <>
                  <TraderColumn party={me} isMe />
                  <TraderColumn party={them} isMe={false} />
                </>
              }
              conversation={
                chatId ? (
                  <ContractChat
                    conversationId={chatId}
                    currentUserId={viewerRole === 'INITIATOR' ? initiatorId : counterpartId}
                    counterpartyName={them.name}
                    title="Trade chat"
                    placeholder="Message about the trade…"
                    emptyHint="Use chat to coordinate shipping and receipt."
                    contractHref={`/messages/${chatId}`}
                  />
                ) : (
                  <Card className="grid flex-1 place-items-center">
                    <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                      {chatError ? (
                        'Chat could not be opened.'
                      ) : (
                        <span className="flex items-center gap-2">
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                          Opening chat…
                        </span>
                      )}
                    </CardContent>
                  </Card>
                )
              }
            />
          ) : null}

          {/* The deal itself. A side can be several items plus cash, so it is
              listed rather than implied by two item ids. */}
          {goods ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">The swap</CardTitle>
                <CardDescription>
                  What each of you agreed to hand over.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-4 sm:flex-row">
                  <GoodsColumn heading="You give" items={goods.yours} />
                  <GoodsColumn heading="You receive" items={goods.theirs} />
                </div>
                {goods.cashAmountCents > 0 ? (
                  <p className="rounded-md bg-muted/40 p-3 text-sm font-medium">
                    {goods.cashDirection === 'outgoing'
                      ? `You also pay ${formatAud(goods.cashAmountCents)} in cash.`
                      : `You also receive ${formatAud(goods.cashAmountCents)} in cash.`}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">What is on the line</CardTitle>
              <CardDescription>
                An unverified trader has agreed we can charge their card for the
                full value of their item. Nothing is charged unless the trade goes
                wrong.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HoldStatus
                holds={holds}
                initiatorId={initiatorId}
                counterpartId={counterpartId}
                viewerRole={viewerRole}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Your actions</CardTitle>
              <CardDescription>
                Only the actions available to you right now are shown.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {viewer ? (
                <ActionBar tradeId={tradeId} state={trade.state} viewer={viewer} />
              ) : null}
              {permittedActionCount === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No actions are available to you in the current state.
                </p>
              ) : null}

              {trade.state === 'FRAUD_RESOLVED' ? (
                <p className="text-sm text-muted-foreground">
                  This trade was closed as fraud. The other trader&apos;s deposit
                  was paid to you.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* --- Demo panel mount point (task 15.3) --- */}
          {demoPanel}
        </>
      )}
    </div>
  );
}

/** A short line telling the viewer which side of the trade they are on. */
function ViewerRoleLine({ role }: { role: TradeViewerRole }) {
  return (
    <p className="text-sm text-muted-foreground">
      You are the{' '}
      <span className="font-medium text-foreground">
        {role === 'INITIATOR' ? 'initiating' : 'counterpart'}
      </span>{' '}
      trader.
    </p>
  );
}
