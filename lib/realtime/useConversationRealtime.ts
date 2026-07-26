'use client';

// lib/realtime/useConversationRealtime.ts
//
// Realtime subscription for a single conversation's messages. Mirrors the
// connection-status + auto-reconnect pattern of `useTradeRealtime`: it fetches
// the initial message history via the browser Supabase client, subscribes to
// Postgres Changes (INSERT/UPDATE) on `cardtrade.messages` filtered by
// `conversation_id`, merges live changes into local state, and exposes a
// {@link ConnectionStatus} for a live / non-live indicator.

import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/browser';
import type { Tables } from '@/lib/supabase/database.types';

/** A message row, strongly typed from the generated database types. */
export type MessageRow = Tables<'messages'>;

/**
 * Connection state of the underlying Realtime channel, surfaced so the chat UI
 * can render a live / reconnecting indicator.
 *
 * - `connecting`    - initial subscription in progress, no live link yet.
 * - `live`          - channel subscribed; message changes arrive in real time.
 * - `reconnecting`  - the channel dropped and a resubscribe is being attempted.
 * - `error`         - reconnection attempts have been exhausted.
 */
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'error';

/** Shape returned by {@link useConversationRealtime}. */
export interface UseConversationRealtimeResult {
  /** The live, chronologically ordered messages for the conversation. */
  messages: MessageRow[];
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

/** Chronological comparator (oldest first) by `created_at`, tie-broken by id. */
function byCreatedAt(a: MessageRow, b: MessageRow): number {
  if (a.created_at === b.created_at) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return a.created_at < b.created_at ? -1 : 1;
}

/**
 * Subscribe to a single conversation's messages in real time.
 *
 * Given a `conversationId`, this hook:
 * 1. Fetches the initial message history via the browser Supabase client.
 * 2. Subscribes to Postgres Changes for INSERT + UPDATE on `messages`
 *    (`conversation_id=eq.conversationId`) so new messages and read-receipt
 *    updates arrive without a reload.
 * 3. Exposes a {@link ConnectionStatus} derived from the channel's subscribe
 *    callback, and auto-reconnects with exponential backoff on drop.
 *
 * The channel is torn down on unmount (or when `conversationId` changes).
 */
export function useConversationRealtime(
  conversationId: string,
): UseConversationRealtimeResult {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting');

  // Stable browser client for the lifetime of the hook instance.
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (supabaseRef.current === null) {
    supabaseRef.current = createClient();
  }

  // Merge a single message change (INSERT/UPDATE) into local state, keeping the
  // list de-duplicated by id and sorted chronologically.
  const applyMessageChange = useCallback(
    (payload: RealtimePostgresChangesPayload<MessageRow>) => {
      const next = payload.new as MessageRow;
      if (!next?.id) return;
      setMessages((prev) => {
        const index = prev.findIndex((m) => m.id === next.id);
        if (index === -1) return [...prev, next].sort(byCreatedAt);
        const copy = prev.slice();
        copy[index] = next;
        return copy.sort(byCreatedAt);
      });
    },
    [],
  );

  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase || !conversationId) return;

    let isMounted = true;
    let channel: RealtimeChannel | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // Load the current message history before/while the channel connects so the
    // thread has content even if the first realtime event has not yet arrived.
    const loadInitial = async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (!isMounted) return;
      if (data) setMessages((data as MessageRow[]).slice().sort(byCreatedAt));
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
        .channel(`conversation:${conversationId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'cardtrade',
            table: 'messages',
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) =>
            applyMessageChange(
              payload as RealtimePostgresChangesPayload<MessageRow>,
            ),
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'cardtrade',
            table: 'messages',
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) =>
            applyMessageChange(
              payload as RealtimePostgresChangesPayload<MessageRow>,
            ),
        )
        .subscribe((status) => {
          if (!isMounted) return;
          switch (status) {
            case 'SUBSCRIBED':
              // Fresh, authoritative snapshot on (re)connect avoids missing any
              // messages that arrived while the channel was down.
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
  }, [conversationId, applyMessageChange]);

  return { messages, connectionStatus };
}
