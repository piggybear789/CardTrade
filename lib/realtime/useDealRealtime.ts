'use client';

// lib/realtime/useDealRealtime.ts
//
// Live subscription for the private 1:1 deal room. Mirrors useTradeRealtime:
// subscribe to Postgres Changes on the single `cardtrade.deals` row and on the
// `cardtrade.deal_holds` rows belonging to it, so each party sees the other's
// actions (terms edits, confirmations, escrow engaging) without a reload.
//
// Both tables are in the realtime publication and RLS still applies, so only the
// two parties receive these changes.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/browser';
import type { Tables } from '@/lib/supabase/database.types';

/** A deal row, strongly typed from the generated database types. */
export type DealRow = Tables<'deals'>;

/** A collateral hold row belonging to a deal. */
export type DealHoldRow = Tables<'deal_holds'>;

/**
 * Connection state of the underlying Realtime channel, surfaced so the deal room
 * can render a live / reconnecting indicator.
 */
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'error';

/** Shape returned by {@link useDealRealtime}. */
export interface UseDealRealtimeResult {
  /** The live deal row, or `null` until the initial fetch resolves. */
  deal: DealRow | null;
  /** The live set of collateral holds for the deal. */
  holds: DealHoldRow[];
  /** Current Realtime connection status. */
  connectionStatus: ConnectionStatus;
}

/** Base delay (ms) for the reconnect backoff. */
const RECONNECT_BASE_DELAY_MS = 1_000;
/** Ceiling (ms) for the reconnect backoff. */
const RECONNECT_MAX_DELAY_MS = 30_000;
/** Maximum number of automatic reconnect attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 10;

/** Exponential backoff delay, capped at {@link RECONNECT_MAX_DELAY_MS}. */
function backoffDelay(attempt: number): number {
  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
}

/**
 * Subscribe to a single deal and its collateral holds in real time.
 *
 * Given a `dealId`, this hook loads an initial snapshot, subscribes to
 * `deals` (`id=eq.dealId`) and `deal_holds` (`deal_id=eq.dealId`), and
 * auto-reconnects with exponential backoff on drop. The channel is torn down on
 * unmount (or when `dealId` changes).
 */
export function useDealRealtime(dealId: string): UseDealRealtimeResult {
  const [deal, setDeal] = useState<DealRow | null>(null);
  const [holds, setHolds] = useState<DealHoldRow[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting');

  // Stable browser client for the lifetime of the hook instance.
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (supabaseRef.current === null) {
    supabaseRef.current = createClient();
  }

  const applyDealChange = useCallback(
    (payload: RealtimePostgresChangesPayload<DealRow>) => {
      if (payload.eventType === 'DELETE') {
        setDeal(null);
        return;
      }
      setDeal(payload.new as DealRow);
    },
    [],
  );

  const applyHoldChange = useCallback(
    (payload: RealtimePostgresChangesPayload<DealHoldRow>) => {
      setHolds((prev) => {
        if (payload.eventType === 'DELETE') {
          const removedId = (payload.old as Partial<DealHoldRow>).id;
          return prev.filter((h) => h.id !== removedId);
        }
        const next = payload.new as DealHoldRow;
        const index = prev.findIndex((h) => h.id === next.id);
        if (index === -1) return [...prev, next];
        const copy = prev.slice();
        copy[index] = next;
        return copy;
      });
    },
    [],
  );

  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase || !dealId) return;

    let isMounted = true;
    let channel: RealtimeChannel | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const loadInitial = async () => {
      const [{ data: dealData }, { data: holdData }] = await Promise.all([
        supabase.from('deals').select('*').eq('id', dealId).maybeSingle(),
        supabase.from('deal_holds').select('*').eq('deal_id', dealId),
      ]);
      if (!isMounted) return;
      if (dealData) setDeal(dealData as DealRow);
      if (holdData) setHolds(holdData as DealHoldRow[]);
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

      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }

      channel = supabase
        .channel(`deal:${dealId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'cardtrade',
            table: 'deals',
            filter: `id=eq.${dealId}`,
          },
          (payload) =>
            applyDealChange(payload as RealtimePostgresChangesPayload<DealRow>),
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'cardtrade',
            table: 'deal_holds',
            filter: `deal_id=eq.${dealId}`,
          },
          (payload) =>
            applyHoldChange(
              payload as RealtimePostgresChangesPayload<DealHoldRow>,
            ),
        )
        .subscribe((status) => {
          if (!isMounted) return;
          switch (status) {
            case 'SUBSCRIBED':
              // Authoritative snapshot on (re)connect: nothing missed while down.
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
  }, [dealId, applyDealChange, applyHoldChange]);

  return { deal, holds, connectionStatus };
}
