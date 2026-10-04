'use client';

// lib/realtime/useInboxRealtime.ts
//
// ONE channel for every conversation the signed-in member is part of, feeding the inbox
// pane that sits beside an open thread (`components/messages/InboxProvider.tsx`).
//
// UNFILTERED, AND RLS IS WHAT SCOPES IT. `messages` has no recipient column — a row
// belongs to a conversation, and the conversation names its two participants — so there
// is no `column=eq.value` filter that means "mine". Postgres Changes applies the table's
// SELECT policy (`messages_participant_select`, 0076 / 0078) to every change before it
// reaches a subscriber, so this channel receives exactly the rows the member could
// already read with a query: the same guarantee every read in this app relies on.
//
// The price of no filter is paid on the Realtime side: each insert on `messages` is
// checked against that policy once per subscribed member — an indexed lookup per pair,
// fine at this scale. If it ever is not, the narrower shape is a filtered subscription on
// `conversations` (`participant_a=eq.<me>` and `participant_b=eq.<me>`), whose
// `last_message_at` every insert bumps, followed by a fetch of the newest row.
//
// Both tables are in the `supabase_realtime` publication on the live project. No
// migration records that, because neither table was created by a migration (see 0076).
//
// Reconnect and topic handling mirror `useConversationRealtime`. Unlike that hook this
// one reports no connection status: the pane has nowhere to show one, and the open
// thread already shows its own.

import { useEffect, useRef } from 'react';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';

import { uniqueRealtimeTopic } from '@/lib/realtime/channelTopic';
import { createClient } from '@/lib/supabase/browser';
import type { Tables } from '@/lib/supabase/database.types';

type MessageRow = Tables<'messages'>;

/** What the inbox does with the channel's traffic. Read through a ref, so may change freely. */
export interface InboxRealtimeHandlers {
  /** A message the member can read was inserted, in any of their conversations. */
  onInsert: (message: MessageRow) => void;
  /** A message the member can read changed — in practice, `read_at` being stamped. */
  onUpdate: (message: MessageRow) => void;
  /**
   * The channel is live: on the first subscribe and again after every reconnect.
   * Nothing from before this moment was delivered, so this is the cue to catch up.
   */
  onLive: () => void;
}

/** Base delay (ms) for the reconnect backoff. */
const RECONNECT_BASE_DELAY_MS = 1_000;
/** Ceiling (ms) for the reconnect backoff. */
const RECONNECT_MAX_DELAY_MS = 30_000;
/** Maximum number of automatic reconnect attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 10;

function backoffDelay(attempt: number): number {
  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
}

function rowOf(payload: RealtimePostgresChangesPayload<MessageRow>): MessageRow | null {
  const row = payload.new as MessageRow;
  return row?.id ? row : null;
}

/**
 * Subscribe to every message change the signed-in member can see, while `enabled`.
 *
 * Turning `enabled` off tears the channel down; turning it back on resubscribes and
 * fires `onLive` again, so whatever arrived in between is caught up rather than lost.
 */
export function useInboxRealtime(
  enabled: boolean,
  handlers: InboxRealtimeHandlers,
): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();

    let isMounted = true;
    let channel: RealtimeChannel | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // Bumps on every subscribe and on cleanup, so an overlapping async teardown cannot
    // attach listeners to a recycled channel or revive a superseded attempt.
    let subscribeEpoch = 0;

    const scheduleReconnect = () => {
      if (!isMounted || reconnectTimer !== null) return;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
      const delay = backoffDelay(reconnectAttempts);
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!isMounted) return;
        void subscribe();
      }, delay);
    };

    const subscribe = async () => {
      if (!isMounted) return;
      const epoch = ++subscribeEpoch;

      const previous = channel;
      channel = null;
      if (previous) await supabase.removeChannel(previous);
      if (!isMounted || epoch !== subscribeEpoch) return;

      const next = supabase
        .channel(uniqueRealtimeTopic('inbox'))
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'cardtrade', table: 'messages' },
          (payload) => {
            const row = rowOf(payload as RealtimePostgresChangesPayload<MessageRow>);
            if (row) handlersRef.current.onInsert(row);
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'cardtrade', table: 'messages' },
          (payload) => {
            const row = rowOf(payload as RealtimePostgresChangesPayload<MessageRow>);
            if (row) handlersRef.current.onUpdate(row);
          },
        );

      channel = next;
      next.subscribe((status) => {
        if (!isMounted || channel !== next) return;
        switch (status) {
          case 'SUBSCRIBED':
            if (reconnectTimer) {
              clearTimeout(reconnectTimer);
              reconnectTimer = null;
            }
            reconnectAttempts = 0;
            handlersRef.current.onLive();
            break;
          case 'CHANNEL_ERROR':
          case 'TIMED_OUT':
          case 'CLOSED':
            channel = null;
            void supabase.removeChannel(next);
            scheduleReconnect();
            break;
        }
      });
    };

    void subscribe();

    return () => {
      isMounted = false;
      subscribeEpoch += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  }, [enabled]);
}
