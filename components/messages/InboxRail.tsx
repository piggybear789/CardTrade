'use client';

// components/messages/InboxRail.tsx
//
// The list in the inbox pane beside an open thread, and the unread count in that pane's
// bar — both drawn from the live inbox (`InboxProvider`) instead of from a server render.
//
// The rows are `InboxThreadList`'s own `rail` rows, unchanged in shape. What is new is
// where their data comes from: the pane now lives in the thread route's layout and is
// not redrawn by a thread switch, so a row's preview, badge and position move when a
// message lands rather than when the member next clicks something.

import { useEffect, useState } from 'react';

import { useInbox } from '@/components/messages/InboxProvider';
import { InboxThreadList } from '@/components/messages/InboxThreadList';

/** How often relative times ("5m ago") are re-read. */
const CLOCK_TICK_MS = 60_000;

/** The pane's list. Renders nothing outside an `InboxProvider`. */
export function InboxRail() {
  const inbox = useInbox();

  // A PERSISTENT LIST NEEDS ITS OWN CLOCK. The server-rendered rail was redrawn on every
  // click, which kept "5m ago" honest by accident; this one is not redrawn at all, so a
  // member who reads one thread for half an hour would otherwise see a list frozen at
  // the moment they opened it.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  if (!inbox) return null;
  return (
    <InboxThreadList
      conversations={inbox.conversations}
      variant="rail"
      activeId={inbox.activeId}
      pendingId={inbox.pendingId}
      onOpen={inbox.open}
    />
  );
}

/**
 * "N unread" for the pane's bar, or nothing.
 *
 * `shrink-0 text-meta` in a bar pinned by `PANE_BAR_MIN_H`, so it appearing and
 * disappearing moves nothing else in the bar.
 */
export function InboxUnreadLabel() {
  const inbox = useInbox();
  const unread =
    inbox?.conversations.reduce((sum, entry) => sum + entry.unreadCount, 0) ?? 0;
  if (unread <= 0) return null;
  return <p className="shrink-0 text-meta text-muted-foreground">{unread} unread</p>;
}
