'use client';

// components/messages/InboxProvider.tsx
//
// The inbox as client state, for the frame around an open conversation
// (`app/(workspace)/messages/(thread)/layout.tsx`).
//
// WHY THIS EXISTS. Switching threads used to be a full re-render of the route: the inbox
// pane, the shell and the thread all lived in the `[id]` page, and a dynamic segment's
// subtree is keyed by its param, so `/messages/A` -> `/messages/B` unmounted all of it
// and the server re-ran the whole inbox query to draw it again. The pane lost its scroll
// position, the page went blank while the server answered, and that is what read as the
// whole page refreshing.
//
// The pane now lives in a LAYOUT, which a sibling navigation does not re-render, and
// this provider keeps it current instead:
//
//   - LIVE. One Realtime channel (`useInboxRealtime`) updates previews, order and unread
//     badges as messages land in any thread, and a catch-up query closes the gap before
//     the channel was live. A message in a thread the list has never seen refreshes the
//     route, because only the server can describe a new conversation.
//   - INSTANT. A click records the thread being opened (`pendingId`) before the router
//     has an answer, so `ThreadPane` can draw it at once from what the client already
//     holds — the list entry for its header, and the thread's own history if it has
//     been open in this tab (`rememberThread`).
//   - READ ON OPEN. A thread's badge clears when it is opened, not when its read receipt
//     lands, and a server snapshot that predates the receipt cannot put it back.
//
// Navigation stays real: the URL, history, back/forward and a reload all go through the
// router, and the server still renders and authorises every thread. What the client
// owns is only what to SHOW while that happens.

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useParams, useRouter } from 'next/navigation';

import { useContractSplit } from '@/components/contract/useContractSplit';
import {
  applyMessageToList,
  isUnreadInbound,
  markConversationReadLocally,
  mergeServerList,
  setUnreadCount,
  timeOf,
  upsertMessage,
} from '@/components/messages/inboxState';
import type {
  ConversationListEntry,
  ConversationShipment,
  MessageRow,
} from '@/lib/actions/messages';
import { useInboxRealtime } from '@/lib/realtime/useInboxRealtime';
import { createClient } from '@/lib/supabase/browser';

/** A thread as it was when it last left the screen, for reopening it instantly. */
export interface ThreadSnapshot {
  messages: MessageRow[];
  shipment: ConversationShipment | null;
}

export interface InboxState {
  currentUserId: string;
  /** The live list, newest activity first. */
  conversations: ConversationListEntry[];
  /** The thread the router has committed: the one in the URL. */
  activeId: string | null;
  /**
   * The thread a click in the pane is opening, until the router commits it. Never equal
   * to `activeId`, and `null` whenever nothing is in flight.
   */
  pendingId: string | null;
  /** Record that a client-side navigation to a thread has started (Link `onNavigate`). */
  open: (conversationId: string) => void;
  /** Keep a thread as it was when it left the screen. */
  rememberThread: (conversationId: string, snapshot: ThreadSnapshot) => void;
  /** The kept copy of a thread, if it has been open in this tab. */
  cachedThread: (conversationId: string) => ThreadSnapshot | undefined;
}

/** The inbox's callbacks alone. Stable for the provider's lifetime. */
export type InboxActions = Pick<InboxState, 'open' | 'rememberThread' | 'cachedThread'>;

const InboxContext = createContext<InboxState | null>(null);
const InboxActionsContext = createContext<InboxActions | null>(null);

/**
 * The live inbox, or `null` outside the thread route — the full-width `/messages` list,
 * or a component rendered in isolation. Callers degrade rather than throw.
 */
export function useInbox(): InboxState | null {
  return use(InboxContext);
}

/**
 * Just the callbacks, from a context whose value never changes.
 *
 * For a component that writes to the inbox but does not draw it — the open thread
 * handing over its history. Reading `useInbox` there would re-render the whole thread,
 * log and all, every time a message landed in ANY conversation.
 */
export function useInboxActions(): InboxActions | null {
  return use(InboxActionsContext);
}

/** Threads kept for instant reopening. Each holds its whole history, so it is bounded. */
const THREAD_CACHE_LIMIT = 20;
/** One recount per thread for a burst of messages or read receipts. */
const RECOUNT_DELAY_MS = 300;
/** One route refresh for a burst of messages in threads the list does not hold. */
const REFRESH_DELAY_MS = 750;
/**
 * How far behind the last sync point a catch-up starts. The snapshot time is the app
 * server's clock and `created_at` is the database's, and everything a catch-up does is
 * idempotent, so a generous overlap costs nothing and a tight one could drop a message.
 */
const CATCH_UP_OVERLAP_MS = 60_000;
/** Threads a catch-up covers, from the top of the list. Ids travel in the request URL. */
const CATCH_UP_CONVERSATIONS = 100;
/** More missed rows than this and refetching the list is cheaper than replaying them. */
const CATCH_UP_LIMIT = 200;

export function InboxProvider({
  currentUserId,
  initialConversations,
  snapshotAt,
  children,
}: {
  currentUserId: string;
  /**
   * The server's list, or `null` when it failed to load. A failure keeps whatever the
   * pane already shows: the list is secondary navigation for a page whose subject — the
   * thread — loads on its own.
   */
  initialConversations: ConversationListEntry[] | null;
  /**
   * When the server took that snapshot (ISO). It changes only when the layout renders on
   * the server again (a refresh, or entering the route), never on a thread switch, so it
   * is what tells a genuinely new snapshot from the same one handed down again.
   */
  snapshotAt: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const params = useParams();
  const activeId = typeof params.id === 'string' ? params.id : null;

  const [conversations, setConversations] = useState<ConversationListEntry[]>(() => {
    const seed = initialConversations ?? [];
    return activeId ? markConversationReadLocally(seed, activeId) : seed;
  });
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Stable containers that never drive a render on their own.
  const [threads] = useState(() => new Map<string, ThreadSnapshot>());
  const [recountTimers] = useState(() => new Map<string, ReturnType<typeof setTimeout>>());

  // A NEW SERVER SNAPSHOT: the layout rendered on the server again. Merged during render,
  // not in an effect, so no frame paints the old list beside the new thread.
  const [mergedSnapshotAt, setMergedSnapshotAt] = useState(snapshotAt);
  if (snapshotAt !== mergedSnapshotAt) {
    setMergedSnapshotAt(snapshotAt);
    const server = initialConversations;
    if (server) {
      const readIds = [activeId, pendingId];
      setConversations((current) => mergeServerList(current, server, readIds));
    }
  }

  // A NAVIGATION COMMITTED. Whatever click was pending is over — this one, a newer one
  // that superseded it, or a navigation from elsewhere (a notification, the back button).
  // Clearing on ANY change, rather than only on reaching the pending id, is what stops a
  // stale preview being drawn over a thread the member actually went to.
  const [committedId, setCommittedId] = useState(activeId);
  if (activeId !== committedId) {
    setCommittedId(activeId);
    setPendingId(null);
    if (activeId) {
      setConversations((current) => markConversationReadLocally(current, activeId));
    }
  }

  // The latest values, for callbacks that run outside render (Realtime, timers).
  const activeRef = useRef(activeId);
  const pendingRef = useRef<string | null>(pendingId);
  const conversationsRef = useRef(conversations);
  useEffect(() => {
    activeRef.current = activeId;
    pendingRef.current = pendingId;
    conversationsRef.current = conversations;
  });

  const mountedRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const timer of recountTimers.values()) clearTimeout(timer);
      recountTimers.clear();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    };
  }, [recountTimers]);

  // Where the next catch-up starts: the newest instant this tab is known to be current
  // through. A server snapshot and every delivered message move it forward.
  const syncedThroughRef = useRef(snapshotAt);
  const noteSyncedThrough = useCallback((iso: string) => {
    if (timeOf(iso) > timeOf(syncedThroughRef.current)) syncedThroughRef.current = iso;
  }, []);
  useEffect(() => {
    noteSyncedThrough(snapshotAt);
  }, [snapshotAt, noteSyncedThrough]);

  /** The open thread and the one being opened are read already, whatever the rows say. */
  const isBeingRead = useCallback(
    (conversationId: string) =>
      conversationId === activeRef.current || conversationId === pendingRef.current,
    [],
  );

  const refreshSoon = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      if (mountedRef.current) router.refresh();
    }, REFRESH_DELAY_MS);
  }, [router]);

  /**
   * Ask the database how many unread member messages a thread has.
   *
   * A badge is never derived by decrementing. An UPDATE says a row was read but not what
   * it was before, and a catch-up can overlap what the snapshot already counted, so
   * every event that could move a badge ends in this one query (the same predicate as
   * `listMyConversations`), and the answer replaces the number.
   */
  const recount = useCallback(
    (conversationId: string) => {
      const queued = recountTimers.get(conversationId);
      if (queued) clearTimeout(queued);
      recountTimers.set(
        conversationId,
        setTimeout(async () => {
          recountTimers.delete(conversationId);
          const { count, error } = await createClient()
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', conversationId)
            .eq('kind', 'USER')
            .neq('sender_id', currentUserId)
            .is('read_at', null);
          if (!mountedRef.current || error || count === null) return;
          if (isBeingRead(conversationId)) return;
          setConversations((current) => setUnreadCount(current, conversationId, count));
        }, RECOUNT_DELAY_MS),
      );
    },
    [currentUserId, isBeingRead, recountTimers],
  );

  /** Keep a closed thread's kept copy current, so reopening it shows what arrived. */
  const patchCachedThread = useCallback(
    (message: MessageRow) => {
      const snapshot = threads.get(message.conversation_id);
      if (!snapshot) return;
      // `set` on an existing key keeps its position, so this does not count as a use
      // for the eviction order.
      threads.set(message.conversation_id, {
        ...snapshot,
        messages: upsertMessage(snapshot.messages, message),
      });
    },
    [threads],
  );

  const handleInsert = useCallback(
    (message: MessageRow) => {
      patchCachedThread(message);
      noteSyncedThrough(message.created_at);
      if (!conversationsRef.current.some((entry) => entry.id === message.conversation_id)) {
        // A conversation started since the snapshot. Only the server can describe it —
        // the other participant, the listing, the contract — so ask it.
        refreshSoon();
        return;
      }
      const counts = !isBeingRead(message.conversation_id);
      setConversations(
        (current) =>
          applyMessageToList(current, message, { currentUserId, countUnread: counts }) ??
          current,
      );
      // The increment above is instant; the recount makes it exact.
      if (counts && isUnreadInbound(message, currentUserId)) recount(message.conversation_id);
    },
    [currentUserId, isBeingRead, noteSyncedThrough, patchCachedThread, recount, refreshSoon],
  );

  const handleUpdate = useCallback(
    (message: MessageRow) => {
      patchCachedThread(message);
      // A read receipt on the other side's message: this member read the thread in
      // another tab or on another device. Their own messages being read moves nothing
      // here — that is the other participant's badge.
      if (
        message.kind !== 'USER' ||
        message.sender_id === currentUserId ||
        message.read_at === null ||
        isBeingRead(message.conversation_id)
      ) {
        return;
      }
      const entry = conversationsRef.current.find(
        (candidate) => candidate.id === message.conversation_id,
      );
      if (entry && entry.unreadCount > 0) recount(message.conversation_id);
    },
    [currentUserId, isBeingRead, patchCachedThread, recount],
  );

  /**
   * Replay what arrived while the channel was not live: before the first subscribe, and
   * during any disconnect. The snapshot this pane started from can also be minutes old —
   * a layout prefetched from the `/messages` list is reused when the member clicks
   * through — and this is what brings it current.
   */
  const catchUp = useCallback(async () => {
    const ids = conversationsRef.current
      .slice(0, CATCH_UP_CONVERSATIONS)
      .map((entry) => entry.id);
    if (ids.length === 0) return;

    const since = new Date(
      timeOf(syncedThroughRef.current) - CATCH_UP_OVERLAP_MS,
    ).toISOString();
    const { data, error } = await createClient()
      .from('messages')
      .select('*')
      .in('conversation_id', ids)
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(CATCH_UP_LIMIT);
    if (!mountedRef.current || error || !data || data.length === 0) return;
    if (data.length >= CATCH_UP_LIMIT) {
      refreshSoon();
      return;
    }

    const rows = [...(data as MessageRow[])].reverse();
    const touched = new Set<string>();
    for (const row of rows) {
      patchCachedThread(row);
      noteSyncedThrough(row.created_at);
      if (isUnreadInbound(row, currentUserId)) touched.add(row.conversation_id);
    }
    // `countUnread: false`: these rows may already be in the snapshot's counts. The
    // recounts below set the badges instead.
    setConversations((current) =>
      rows.reduce(
        (list, row) =>
          applyMessageToList(list, row, { currentUserId, countUnread: false }) ?? list,
        current,
      ),
    );
    for (const conversationId of touched) {
      if (!isBeingRead(conversationId)) recount(conversationId);
    }
  }, [currentUserId, isBeingRead, noteSyncedThrough, patchCachedThread, recount, refreshSoon]);

  // The pane is only on screen from `lg` (`InboxTwoPane`). Below that the thread is the
  // whole screen and the list is a separate route, so a channel here would feed a list
  // nobody can see. Widening the window subscribes, and the catch-up covers the gap.
  const paneVisible = useContractSplit();
  useInboxRealtime(paneVisible, {
    onInsert: handleInsert,
    onUpdate: handleUpdate,
    onLive: () => void catchUp(),
  });

  const open = useCallback((conversationId: string) => {
    const opening = conversationId === activeRef.current ? null : conversationId;
    pendingRef.current = opening;
    setPendingId(opening);
    setConversations((current) => markConversationReadLocally(current, conversationId));
  }, []);

  const rememberThread = useCallback(
    (conversationId: string, snapshot: ThreadSnapshot) => {
      // Delete first so a re-remembered thread moves to the young end of the order.
      threads.delete(conversationId);
      threads.set(conversationId, snapshot);
      while (threads.size > THREAD_CACHE_LIMIT) {
        const oldest = threads.keys().next().value;
        if (oldest === undefined) break;
        threads.delete(oldest);
      }
    },
    [threads],
  );

  const cachedThread = useCallback(
    (conversationId: string) => threads.get(conversationId),
    [threads],
  );

  const value = useMemo<InboxState>(
    () => ({
      currentUserId,
      conversations,
      activeId,
      pendingId: pendingId !== null && pendingId !== activeId ? pendingId : null,
      open,
      rememberThread,
      cachedThread,
    }),
    [currentUserId, conversations, activeId, pendingId, open, rememberThread, cachedThread],
  );
  const actions = useMemo<InboxActions>(
    () => ({ open, rememberThread, cachedThread }),
    [open, rememberThread, cachedThread],
  );

  return (
    <InboxActionsContext value={actions}>
      <InboxContext value={value}>{children}</InboxContext>
    </InboxActionsContext>
  );
}
