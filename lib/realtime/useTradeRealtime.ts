'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { uniqueRealtimeTopic } from '@/lib/realtime/channelTopic';
import { createClient } from '@/lib/supabase/browser';
import type { Tables } from '@/lib/supabase/database.types';

/** A trade row, strongly typed from the generated database types. */
export type TradeRow = Tables<'trades'>;

/** A pre-auth hold row, strongly typed from the generated database types. */
export type HoldRow = Tables<'pre_auth_holds'>;

/** One append-only audit row from the trade state machine. */
export type TradeTransitionRow = Tables<'trade_state_transitions'>;

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

/** Server-rendered starting point, so the room has state on its first paint. */
export interface TradeRealtimeSeed {
  trade: TradeRow;
  holds: HoldRow[];
  transitions: TradeTransitionRow[];
}

/** Shape returned by {@link useTradeRealtime}. */
export interface UseTradeRealtimeResult {
  /** The live trade row, or `null` when no seed was given and no fetch has resolved. */
  trade: TradeRow | null;
  /** The live set of pre-auth holds for the trade. */
  holds: HoldRow[];
  /** Append-only state-machine history, oldest first. */
  transitions: TradeTransitionRow[];
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
 * Subscribe to a single trade, its pre-auth holds, and its state-transition
 * history in real time.
 *
 * Given a `tradeId`, this hook:
 * 1. Starts from `seed` — the rows the server already rendered with — so the
 *    contract is in the HTML rather than appearing after hydration.
 * 2. Subscribes to Postgres Changes on `trades`, `pre_auth_holds`, and
 *    `trade_state_transitions` so updates arrive without a page reload
 *    (Req 11.2).
 * 3. Exposes a {@link ConnectionStatus} derived from the channel's subscribe
 *    callback, and auto-reconnects with exponential backoff on drop (Req 11.5).
 *
 * SEED, THEN SUBSCRIBE. Without a seed this hook started at `null` and the room
 * gated its entire body on that, so the server's five queries produced HTML with
 * no contract in it and the room only existed after hydration plus a client
 * fetch. `useCashSaleRealtime` never had that problem because `CashSaleView`
 * falls back to its server snapshot; this is the same arrangement, done in the
 * hook so every consumer gets it.
 *
 * The channel is torn down on unmount (or when `tradeId` changes).
 */
export function useTradeRealtime(
  tradeId: string,
  seed?: TradeRealtimeSeed,
): UseTradeRealtimeResult {
  // Initialisers run once, so a later realtime update is never clobbered by the
  // seed — and the seed prop changing on a server re-render does not reset live
  // state that is already ahead of it.
  const [trade, setTrade] = useState<TradeRow | null>(seed?.trade ?? null);
  const [holds, setHolds] = useState<HoldRow[]>(seed?.holds ?? []);
  const [transitions, setTransitions] = useState<TradeTransitionRow[]>(
    seed?.transitions ?? [],
  );
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting');

  // Read once: whether this instance started with server state decides only
  // whether the mount-time fetch is needed, and must not re-trigger the effect.
  const hasSeedRef = useRef(seed != null);

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

  // Append-only: INSERT is the only mutation the audit table admits.
  const applyTransitionInsert = useCallback(
    (payload: RealtimePostgresChangesPayload<TradeTransitionRow>) => {
      if (payload.eventType !== 'INSERT') return;
      const next = payload.new as TradeTransitionRow;
      setTransitions((prev) => {
        if (prev.some((row) => row.id === next.id)) return prev;
        return [...prev, next].sort(
          (a, b) =>
            a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
        );
      });
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
    let subscribeEpoch = 0;

    // Load the current trade + holds + history before/while the channel connects,
    // so the view has data even if the first realtime event has not yet arrived.
    const loadInitial = async () => {
      const [
        { data: tradeData },
        { data: holdData },
        { data: transitionData },
      ] = await Promise.all([
        supabase.from('trades').select('*').eq('id', tradeId).single(),
        supabase.from('pre_auth_holds').select('*').eq('trade_id', tradeId),
        supabase
          .from('trade_state_transitions')
          .select('*')
          .eq('trade_id', tradeId)
          .order('created_at'),
      ]);
      if (!isMounted) return;
      if (tradeData) setTrade(tradeData as TradeRow);
      if (holdData) setHolds(holdData as HoldRow[]);
      if (transitionData) setTransitions(transitionData as TradeTransitionRow[]);
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
        void subscribe();
      }, delay);
    };

    const subscribe = async () => {
      if (!isMounted) return;
      const epoch = ++subscribeEpoch;

      // Tear down any previous channel before creating a fresh one.
      if (channel) {
        const previous = channel;
        channel = null;
        await supabase.removeChannel(previous);
      }
      if (!isMounted || epoch !== subscribeEpoch) return;

      const nextChannel = supabase
        .channel(uniqueRealtimeTopic(`trade:${tradeId}`))
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
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'cardtrade',
            table: 'trade_state_transitions',
            filter: `trade_id=eq.${tradeId}`,
          },
          (payload) =>
            applyTransitionInsert(
              payload as RealtimePostgresChangesPayload<TradeTransitionRow>,
            ),
        );

      channel = nextChannel;
      nextChannel.subscribe((status) => {
        if (!isMounted || channel !== nextChannel) return;
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
            channel = null;
            void supabase.removeChannel(nextChannel);
            scheduleReconnect();
            break;
        }
      });
    };

    setConnectionStatus('connecting');
    // Only when we have nothing to show. The `SUBSCRIBED` callback re-runs this
    // anyway, so a seeded room used to fetch the same three tables twice on
    // every open — six queries, four of them redundant with the server's.
    if (!hasSeedRef.current) void loadInitial();
    void subscribe();

    return () => {
      isMounted = false;
      subscribeEpoch += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [tradeId, applyTradeChange, applyHoldChange, applyTransitionInsert]);

  return { trade, holds, transitions, connectionStatus };
}
