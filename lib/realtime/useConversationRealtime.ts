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
import { uniqueRealtimeTopic } from '@/lib/realtime/channelTopic';
import { createClient } from '@/lib/supabase/browser';
import type { Tables } from '@/lib/supabase/database.types';

/** A message row, strongly typed from the generated database types. */
export type MessageRow = Tables<'messages'>;

/**
 * Connection state of the underlying Realtime channel, surfaced so the chat UI
 * can render a live / reconnecting indicator.
 *
 * - `connecting`    — initial subscription in progress, no live link yet.
 * - `live`          — channel subscribed; message changes arrive in real time.
 * - `reconnecting`  — the channel dropped and a resubscribe is being attempted.
 * - `error`         — reconnection attempts have been exhausted.
 */
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'error';

/** Shape returned by {@link useConversationRealtime}. */
export interface UseConversationRealtimeResult {
  /** The live, chronologically ordered messages for the conversation. */
  messages: MessageRow[];
  /** Current Realtime connection status (drives the live indicator). */
  connectionStatus: ConnectionStatus;
  /** Show a locally-created message before the server has confirmed it. */
  addOptimistic: (message: MessageRow) => void;
  /**
   * Retire a placeholder: swap in the real row on success, or drop it on
   * failure so a message that never sent does not sit in the thread looking
   * like it did.
   */
  settleOptimistic: (tempId: string, message: MessageRow | null) => void;
}

/**
 * Marks a row that exists only in this browser. Prefixed rather than flagged
 * with an extra field so it survives every path that treats these as plain
 * `MessageRow`s — sorting, grouping, keying — without widening the type.
 */
const OPTIMISTIC_PREFIX = 'optimistic:';

/** True for a placeholder this client created and the server has not echoed. */
export function isOptimisticMessage(message: MessageRow): boolean {
  return message.id.startsWith(OPTIMISTIC_PREFIX);
}

/**
 * Build the placeholder a composer shows the instant someone hits send.
 *
 * `created_at` is the local clock, which is close enough to sort correctly
 * against a thread whose other rows are minutes old, and is replaced by the
 * server's value the moment the insert comes back.
 */
export function optimisticMessage(input: {
  conversationId: string;
  senderId: string;
  body: string;
}): MessageRow {
  return {
    id: `${OPTIMISTIC_PREFIX}${crypto.randomUUID()}`,
    conversation_id: input.conversationId,
    sender_id: input.senderId,
    kind: 'USER',
    system_event: null,
    body: input.body,
    attachment_path: null,
    attachment_name: null,
    attachment_mime: null,
    attachment_bytes: null,
    read_at: null,
    created_at: new Date().toISOString(),
  };
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
        // Drop the placeholder this row is the echo of. The realtime INSERT can
        // land BEFORE the server action returns, so waiting for `settle` alone
        // would show the sender their own message twice for a moment.
        const withoutEcho = prev.filter(
          (m) =>
            !(
              isOptimisticMessage(m) &&
              m.sender_id === next.sender_id &&
              m.body === next.body
            ),
        );
        const index = withoutEcho.findIndex((m) => m.id === next.id);
        if (index === -1) return [...withoutEcho, next].sort(byCreatedAt);
        const copy = withoutEcho.slice();
        copy[index] = next;
        return copy.sort(byCreatedAt);
      });
    },
    [],
  );

  const addOptimistic = useCallback((message: MessageRow) => {
    setMessages((prev) => [...prev, message].sort(byCreatedAt));
  }, []);

  const settleOptimistic = useCallback(
    (tempId: string, message: MessageRow | null) => {
      setMessages((prev) => {
        const without = prev.filter((m) => m.id !== tempId);
        // The realtime echo usually beats this, so only merge when it has not.
        if (!message || without.some((m) => m.id === message.id)) return without;
        return [...without, message].sort(byCreatedAt);
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
    // Bumps on every subscribe/cleanup so overlapping async teardowns cannot
    // attach listeners to a recycled channel or a superseded attempt.
    let subscribeEpoch = 0;

    // Load the current message history before/while the channel connects so the
    // thread has content even if the first realtime event has not yet arrived.
    const loadInitial = async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (!isMounted) return;
      if (data) {
        setMessages((prev) => {
          const rows = data as MessageRow[];
          const map = new Map<string, MessageRow>();
          for (const m of rows) map.set(m.id, m);
          for (const m of prev) {
            // A placeholder whose real row is already in this refetch has been
            // superseded. Without this the two would sit side by side, because
            // they have different ids and both survive the merge.
            if (
              isOptimisticMessage(m) &&
              rows.some((row) => row.sender_id === m.sender_id && row.body === m.body)
            ) {
              continue;
            }
            map.set(m.id, m);
          }
          return Array.from(map.values()).sort(byCreatedAt);
        });
      }
    };

    const scheduleReconnect = () => {
      if (!isMounted || reconnectTimer !== null) return;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionStatus('error');
        return;
      }
      const delay = backoffDelay(reconnectAttempts);
      reconnectAttempts += 1;
      setConnectionStatus('reconnecting');
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!isMounted) return;
        void subscribe();
      }, delay);
    };

    const subscribe = async () => {
      if (!isMounted) return;
      const epoch = ++subscribeEpoch;

      // Retire the previous channel before replacing it. Await removal so the
      // client registry cannot hand back a still-subscribed topic. Stale CLOSED
      // callbacks are ignored via the channel !== nextChannel guard below.
      const previousChannel = channel;
      channel = null;
      if (previousChannel) {
        await supabase.removeChannel(previousChannel);
      }
      if (!isMounted || epoch !== subscribeEpoch) return;

      // UUID topic: a per-effect counter still collides across Strict Mode
      // remounts and ChatThread + ContractChat sharing one conversationId.
      const nextChannel = supabase
        .channel(uniqueRealtimeTopic(`conversation:${conversationId}`))
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
        );

      channel = nextChannel;
      nextChannel.subscribe((status) => {
        if (!isMounted || channel !== nextChannel) return;
        switch (status) {
          case 'SUBSCRIBED':
            // A successful subscription invalidates any retry queued by an earlier
            // terminal callback and refreshes messages missed while disconnected.
            if (reconnectTimer) {
              clearTimeout(reconnectTimer);
              reconnectTimer = null;
            }
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
    void loadInitial();
    void subscribe();

    return () => {
      isMounted = false;
      subscribeEpoch += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  }, [conversationId, applyMessageChange]);

  return { messages, connectionStatus, addOptimistic, settleOptimistic };
}
