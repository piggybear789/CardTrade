'use client';

// lib/realtime/useNotifications.ts
//
// Realtime subscription for the signed-in user's in-app notifications. Mirrors
// the connection-status + auto-reconnect pattern of `useTradeRealtime` and
// `useConversationRealtime`: it seeds from a server-provided initial list,
// subscribes to Postgres Changes on `cardtrade.notifications` filtered by
// `user_id=eq.<meId>`, merges rows into local state, and exposes a
// {@link ConnectionStatus} for a live / reconnecting indicator plus a derived
// unread count.
//
// BOTH INSERT AND UPDATE are subscribed, and the UPDATE half is load-bearing:
// this hook is mounted twice per page (the header bell and, on /notifications,
// the centre), those instances hold separate state, and read-state is changed by
// whichever one the member clicked. UPDATE is the only channel through which the
// other instance learns. See `applyUpdate`.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { uniqueRealtimeTopic } from '@/lib/realtime/channelTopic';
import { createClient } from '@/lib/supabase/browser';
import type { Tables } from '@/lib/supabase/database.types';

/** A notification row, strongly typed from the generated database types. */
export type NotificationRow = Tables<'notifications'>;

/**
 * Connection state of the underlying Realtime channel, surfaced so the bell UI
 * can render a live / reconnecting indicator.
 *
 * - `connecting`    — initial subscription in progress, no live link yet.
 * - `live`          — channel subscribed; new notifications arrive in real time.
 * - `reconnecting`  — the channel dropped and a resubscribe is being attempted.
 * - `error`         — reconnection attempts have been exhausted.
 */
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'error';

/** Shape returned by {@link useNotifications}. */
export interface UseNotificationsResult {
  /** The caller's notifications, newest-first. */
  notifications: NotificationRow[];
  /** Count of notifications with `read_at === null`. */
  unreadCount: number;
  /** Current Realtime connection status (drives the live indicator). */
  connectionStatus: ConnectionStatus;
  /** Optimistically mark one notification read in local state. */
  markReadLocal: (id: string) => void;
  /** Optimistically mark all notifications read in local state. */
  markAllReadLocal: () => void;
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

/** Reverse-chronological comparator (newest first) by `created_at`, id tie-break. */
function byCreatedAtDesc(a: NotificationRow, b: NotificationRow): number {
  if (a.created_at === b.created_at) return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  return a.created_at < b.created_at ? 1 : -1;
}

/**
 * Subscribe to the signed-in user's notifications in real time.
 *
 * Given the current user's `meId` and an `initial` server-provided list, this
 * hook:
 * 1. Seeds local state from `initial` (so the bell has content immediately).
 * 2. Subscribes to Postgres Changes for INSERT on `notifications`
 *    (`user_id=eq.meId`) so new notifications arrive without a reload.
 * 3. Exposes a {@link ConnectionStatus} derived from the channel's subscribe
 *    callback, and auto-reconnects with exponential backoff on drop. On every
 *    (re)connect it reloads a fresh snapshot to avoid missing rows that arrived
 *    while the channel was down.
 *
 * The channel is torn down on unmount (or when `meId` changes).
 */
export function useNotifications(
  meId: string | null | undefined,
  initial: NotificationRow[] = [],
): UseNotificationsResult {
  const [notifications, setNotifications] = useState<NotificationRow[]>(() =>
    [...initial].sort(byCreatedAtDesc),
  );
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting');

  // Stable browser client for the lifetime of the hook instance.
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (supabaseRef.current === null) {
    supabaseRef.current = createClient();
  }

  // Merge a single INSERT into local state, de-duplicated by id, newest-first.
  const applyInsert = useCallback(
    (payload: RealtimePostgresChangesPayload<NotificationRow>) => {
      const next = payload.new as NotificationRow;
      if (!next?.id) return;
      setNotifications((prev) => {
        if (prev.some((n) => n.id === next.id)) return prev;
        return [next, ...prev].sort(byCreatedAtDesc);
      });
    },
    [],
  );

  /**
   * Merge a single UPDATE — in practice a `read_at` transition — into local state.
   *
   * WHY UPDATE IS SUBSCRIBED AND NOT JUST INSERT. This hook is mounted more than
   * once per page: `NotificationBell` in the header has an instance, and
   * `NotificationCenter` on /notifications has another. They are separate React
   * state, so `markAllReadLocal()` called by the centre cannot be seen by the
   * bell, and with only INSERT subscribed there was no channel through which the
   * bell could ever learn the rows had been read. The observable result was that
   * "Mark all read" greyed the list out while the header badge kept saying
   * "1 unread" until a full page reload.
   *
   * Subscribing to UPDATE makes the hook's state track the TABLE rather than
   * whichever instance happened to perform the mutation, which is what it already
   * claimed to do — and it fixes the same divergence for a read performed in
   * another tab or on another device.
   *
   * Rows are merged, never appended: an UPDATE for a row this instance has not
   * loaded (older than its 50-row window) is ignored rather than being inserted
   * out of position.
   */
  const applyUpdate = useCallback(
    (payload: RealtimePostgresChangesPayload<NotificationRow>) => {
      const next = payload.new as NotificationRow;
      if (!next?.id) return;
      setNotifications((prev) => {
        if (!prev.some((n) => n.id === next.id)) return prev;
        return prev.map((n) => (n.id === next.id ? { ...n, ...next } : n));
      });
    },
    [],
  );

  const markReadLocal = useCallback((id: string) => {
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => (n.id === id && n.read_at === null ? { ...n, read_at: now } : n)),
    );
  }, []);

  const markAllReadLocal = useCallback(() => {
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => (n.read_at === null ? { ...n, read_at: now } : n)),
    );
  }, []);

  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase || !meId) return;

    let isMounted = true;
    let channel: RealtimeChannel | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let subscribeEpoch = 0;

    // Load a fresh snapshot before/while the channel connects so the bell stays
    // authoritative even if the first realtime event has not yet arrived.
    const loadInitial = async () => {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!isMounted) return;
      if (data) {
        setNotifications((prev) => {
          const map = new Map<string, NotificationRow>();
          for (const n of data as NotificationRow[]) {
            map.set(n.id, n);
          }
          for (const n of prev) {
            const incoming = map.get(n.id);
            if (!incoming) {
              map.set(n.id, n);
            } else if (n.read_at !== null && incoming.read_at === null) {
              // Preserve local optimistic read state
              map.set(n.id, { ...incoming, read_at: n.read_at });
            }
          }
          return Array.from(map.values()).sort(byCreatedAtDesc);
        });
      }
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
      const epoch = ++subscribeEpoch;

      // Tear down any previous channel before creating a fresh one.
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }

      const nextChannel = supabase
        .channel(uniqueRealtimeTopic(`notifications:${meId}`))
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'cardtrade',
            table: 'notifications',
            filter: `user_id=eq.${meId}`,
          },
          (payload) =>
            applyInsert(
              payload as RealtimePostgresChangesPayload<NotificationRow>,
            ),
        )
        // Read-state changes. See `applyUpdate` for why this is not optional:
        // without it the header bell and the notification list hold divergent
        // state and the badge survives "Mark all read" until a page reload.
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'cardtrade',
            table: 'notifications',
            filter: `user_id=eq.${meId}`,
          },
          (payload) =>
            applyUpdate(
              payload as RealtimePostgresChangesPayload<NotificationRow>,
            ),
        );

      channel = nextChannel;
      nextChannel.subscribe((status) => {
        if (!isMounted || channel !== nextChannel || epoch !== subscribeEpoch) return;
        switch (status) {
          case 'SUBSCRIBED':
            // Fresh snapshot on (re)connect avoids missing notifications that
            // arrived while the channel was down.
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
    subscribe();

    return () => {
      isMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [meId, applyInsert, applyUpdate]);

  const unreadCount = useMemo(
    () => notifications.reduce((acc, n) => (n.read_at === null ? acc + 1 : acc), 0),
    [notifications],
  );

  return {
    notifications,
    unreadCount,
    connectionStatus,
    markReadLocal,
    markAllReadLocal,
  };
}
