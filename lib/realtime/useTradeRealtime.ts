'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/browser';
import type { Tables } from '@/lib/supabase/database.types';

/** A trade row, strongly typed from the generated database types. */
export type TradeRow = Tables<'trades'>;

/** A pre-auth hold row, strongly typed from the generated database types. */
export type HoldRow = Tables<'pre_auth_holds'>;

/**
 * Connection state of the underlying Realtime channel, surfaced to the UI so a
 * live / non-live indicator can be rendered (Req 11.5).
 *
 * - `connecting`    — initial subscription in progress, no live link yet.
 * - `live`          — channel subscribed; row changes arrive in real time.
 * - `reconnecting`  — the channel dropped and a resubscribe is being attempted.
 * - `error`         — reconnection attempts have been exhausted.
 */
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'error';

/** Shape returned by {@link useTradeRealtime}. */
export interface UseTradeRealtimeResult {
  /** The live trade row, or `null` until the initial fetch resolves. */
  trade: TradeRow | null;
  /** The live set of pre-auth holds for the trade. */
  holds: HoldRow[];
  /** Current Realtime connection status (drives the live indicator). */
  connectionStatus: ConnectionStatus;
}

/** Base delay (ms) for the reconnect backoff. */
const RECONNECT_BASE_DELAY_MS = 1_000;
/** Ceiling (ms) for the reconnect backoff. */
const RECONNECT_MAX_DELAY_MS = 30_000;
/** Maximum number of automatic reconnect attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 10;

/** Compute an exponential backoff delay, capped at {@link RECONNECT_MAX_DELAY_MS}. */
function backoffDelay(attempt: number): number {
  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
}

/**
 * Subscribe to a single trade and its pre-auth holds in real time.
 *
 * Given a `tradeId`, this hook:
 * 1. Fetches the initial trade row and its associated `pre_auth_holds` via the
 *    browser Supabase client.
 * 2. Subscribes to Postgres Changes on the `trades` row (`id=eq.tradeId`) and on
 *    `pre_auth_holds` (`trade_id=eq.tradeId`) so updates arrive without a page
 *    reload, well within the 5s budget (Req 11.2).
 * 3. Exposes a {@link ConnectionStatus} derived from the channel's subscribe
 *    callback, and auto-reconnects with exponential backoff on drop (Req 11.5).
 *
 * The channel is torn down on unmount (or when `tradeId` changes).
 */
export function useTradeRealtime(tradeId: string): UseTradeRealtimeResult {
  const [trade, setTrade] = useState<TradeRow | null>(null);
  const [holds, setHolds] = useState<HoldRow[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting');

  // Stable browser client for the lifetime of the hook instance.
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (supabaseRef.current === null) {
    supabaseRef.current = createClient();
  }

  // Merge a single hold change (INSERT/UPDATE/DELETE) into local state.
  const applyHoldChange = useCallback(
    (payload: RealtimePostgresChangesPayload<HoldRow>) => {
      setHolds((prev) => {
        if (payload.eventType === 'DELETE') {
          const removedId = (payload.old as Partial<HoldRow>).id;
          return prev.filter((h) => h.id !== removedId);
        }
        const next = payload.new as HoldRow;
        const index = prev.findIndex((h) => h.id === next.id);
        if (index === -1) return [...prev, next];
        const copy = prev.slice();
        copy[index] = next;
        return copy;
      });
    },
    [],
  );

  // Merge a single trade change into local state.
  const applyTradeChange = useCallback(
    (payload: RealtimePostgresChangesPayload<TradeRow>) => {
      if (payload.eventType === 'DELETE') {
        setTrade(null);
        return;
      }
      setTrade(payload.new as TradeRow);
    },
    [],
  );

  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase || !tradeId) return;

    let isMounted = true;
    let channel: RealtimeChannel | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // Load the current trade + holds snapshot before/while the channel connects,
    // so the view has data even if the first realtime event has not yet arrived.
    const loadInitial = async () => {
      const [{ data: tradeData }, { data: holdData }] = await Promise.all([
        supabase.from('trades').select('*').eq('id', tradeId).single(),
        supabase.from('pre_auth_holds').select('*').eq('trade_id', tradeId),
      ]);
      if (!isMounted) return;
      if (tradeData) setTrade(tradeData as TradeRow);
      if (holdData) setHolds(holdData as HoldRow[]);
    };

    const scheduleReconnect = () => {
      if (!isMounted) return;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionStatus('error');
        return;
      }
      const delay = backoffDelay(reconnectAttempts);
      reconnectAttempts += 1;
      setConnectionStatus('reconnecting');
      reconnectTimer = setTimeout(() => {
        if (!isMounted) return;
        subscribe();
      }, delay);
    };

    const subscribe = () => {
      if (!isMounted) return;

      // Tear down any previous channel before creating a fresh one.
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }

      channel = supabase
        .channel(`trade:${tradeId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'cardtrade',
            table: 'trades',
            filter: `id=eq.${tradeId}`,
          },
          (payload) =>
            applyTradeChange(
              payload as RealtimePostgresChangesPayload<TradeRow>,
            ),
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'cardtrade',
            table: 'pre_auth_holds',
            filter: `trade_id=eq.${tradeId}`,
          },
          (payload) =>
            applyHoldChange(
              payload as RealtimePostgresChangesPayload<HoldRow>,
            ),
        )
        .subscribe((status) => {
          if (!isMounted) return;
          switch (status) {
            case 'SUBSCRIBED':
              // Fresh, authoritative snapshot on (re)connect avoids missing any
              // changes that occurred while the channel was down.
              reconnectAttempts = 0;
              setConnectionStatus('live');
              void loadInitial();
              break;
            case 'CHANNEL_ERROR':
            case 'TIMED_OUT':
            case 'CLOSED':
              scheduleReconnect();
              break;
          }
        });
    };

    setConnectionStatus('connecting');
    void loadInitial();
    subscribe();

    return () => {
      isMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [tradeId, applyTradeChange, applyHoldChange]);

  return { trade, holds, connectionStatus };
}
