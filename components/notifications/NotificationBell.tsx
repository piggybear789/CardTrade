'use client';

// components/notifications/NotificationBell.tsx
//
// The in-app NOTIFICATION CENTER entry point for the site header (Phase 4). A
// bell icon with an unread-count badge that opens a lightweight popover panel
// listing recent notifications. Each row shows the title, what it is about, a
// relative timestamp, and an unread dot; clicking a row marks it read and
// navigates to its `link`. A "Mark all as read" action clears every unread badge.
//
// The list is seeded by the server. Opening the panel refreshes it through a
// server action. A Realtime channel here pulled the browser Supabase client
// into every page, including the catalog, for a badge that is already correct
// on navigation. The notifications page keeps the live subscription.
//
// The panel is a Popover rather than a hand-placed absolute box: the bell is not
// the last control in the header, so anchoring a panel to its edge pushes the
// panel off the opposite side of a narrow viewport. The popover keeps itself
// inside the viewport, and portals out of the header's backdrop filter.
//
// THE PANEL, 2026-11-28 (a Mobbin pass over Jira, Instagram, TikTok, Faire and Air):
// rows grouped by age under the same headings as the notifications page, inset rows
// with no rules between them (the inbox's shape), the title and one plain-text action
// on top, and "See all notifications" at the foot.

import { useId, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { BellIcon } from '@/components/ui/icons';
import { toast } from 'sonner';

import {
  HEADER_ICON_BADGE,
  HEADER_ICON_BUTTON,
  HEADER_ICON_GLYPH,
} from '@/components/layout/HeaderControls';
import { HeaderTooltip } from '@/components/layout/HeaderTooltip';
import {
  groupNotificationsByAge,
  needsReader,
  NotificationRowBody,
  notificationRowClass,
} from '@/components/notifications/notificationPresentation';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CountBadge } from '@/components/ui/count-badge';
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/actions/notifications';
import type { NotificationRow } from '@/lib/realtime/useNotifications';

/** Cap the number of rows shown in the dropdown panel. */
const PANEL_LIMIT = 12;

export interface NotificationBellProps {
  /** Server-fetched initial notifications (newest-first) to seed the panel. */
  initialNotifications: NotificationRow[];
}

export function NotificationBell({
  initialNotifications,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  // TWO TRANSITIONS, ON PURPOSE. "Mark all as read" used to wait on the one the list
  // refresh runs in, so it greyed out for a moment every time the panel opened.
  const [, startBackground] = useTransition();
  const [isMarkingAll, startMarkAll] = useTransition();
  const [notifications, setNotifications] = useState(initialNotifications);
  // The instant the panel opened, which its rows are grouped by age against. Taken on
  // open, so a group never changes under the reader while the panel is up.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  // When "Mark all as read" was last pressed. A refresh that set off before it reads the
  // rows as they were, and must not put the dots back on rows it cleared.
  const markedAllAt = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const unreadCount = notifications.reduce(
    (count, notification) => count + (notification.read_at === null ? 1 : 0),
    0,
  );

  function markReadLocal(id: string) {
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id && notification.read_at === null
          ? { ...notification, read_at: readAt }
          : notification,
      ),
    );
  }

  function markAllReadLocal(readAt: string) {
    setNotifications((current) =>
      current.map((notification) =>
        notification.read_at === null ? { ...notification, read_at: readAt } : notification,
      ),
    );
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    const requestedAt = Date.now();
    setOpenedAt(new Date(requestedAt).toISOString());
    startBackground(async () => {
      const result = await listMyNotifications(PANEL_LIMIT);
      if (!result.ok) return;
      const clearedAt = markedAllAt.current;
      setNotifications(
        clearedAt !== null && clearedAt >= requestedAt
          ? result.notifications.map((notification) =>
              notification.read_at === null && Date.parse(notification.created_at) <= clearedAt
                ? { ...notification, read_at: new Date(clearedAt).toISOString() }
                : notification,
            )
          : result.notifications,
      );
    });
  }

  function handleSelect(notification: NotificationRow) {
    // Optimistically mark read, persist best-effort, then navigate.
    if (notification.read_at === null) {
      markReadLocal(notification.id);
      startBackground(async () => {
        const res = await markNotificationRead(notification.id);
        if (!res.ok) {
          toast.error('Could not mark notification as read.');
        }
      });
    }
    setOpen(false);
  }

  function handleMarkAll() {
    const at = Date.now();
    markedAllAt.current = at;
    markAllReadLocal(new Date(at).toISOString());
    startMarkAll(async () => {
      const result = await markAllNotificationsRead();
      if (!result.ok) {
        toast.error('Could not mark notifications as read.');
      }
    });
  }

  const visible = notifications.slice(0, PANEL_LIMIT);
  // The page's own buckets ("Last 24 hours", "Last 7 days"…), NOT unread first: pinning
  // unread rows to the top would reshuffle the list on every click and rearrange it
  // wholesale on "Mark all as read" (the rule `NotificationCenter` records).
  const groups = open
    ? groupNotificationsByAge(visible, openedAt ?? new Date().toISOString())
    : [];

  return (
      <Popover open={open} onOpenChange={handleOpenChange}>
      {/* The tooltip wraps the TRIGGER, inside the Popover, so one button carries
          both. It needs the rail's `TooltipProvider` (see `SignedInHeaderTools`).
          Pressing the bell closes the label, and it stays closed while the
          pointer rests there, so it never sits on top of the open panel. */}
      {/* The tooltip wraps the TRIGGER, inside the Popover, so one button carries
          both. It needs the rail's `TooltipProvider` (see `SignedInHeaderTools`).
          Pressing the bell closes the label, and it stays closed while the
          pointer rests there, so it never sits on top of the open panel. */}
      <HeaderTooltip label="Notifications">
        <PopoverTrigger
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications'
          }
          className={HEADER_ICON_BUTTON}
        >
          <Icon
            icon={BellIcon}
            weight={open ? 'fill' : undefined}
            className={HEADER_ICON_GLYPH}
            aria-hidden
          />
          <CountBadge count={unreadCount} className={HEADER_ICON_BADGE} />
        </PopoverTrigger>
      </HeaderTooltip>

      <PopoverContent
        ref={panelRef}
        aria-label="Notifications"
        align="end"
        sideOffset={8}
        // `-1` so the panel can take focus itself without entering the tab order.
        tabIndex={-1}
        // FOCUS THE PANEL, NOT THE FIRST CONTROL IN IT. Radix's default lands on
        // "Mark all as read" — a bulk action, wearing the violet focus edge, before the
        // member has read a single row. Focus goes to the labelled panel instead, which
        // is also what a screen reader should announce on open.
        //
        // This is NOT a focus trap opt-out: preventing the default only redirects where
        // focus lands INSIDE Radix's focus scope, so Tab still walks the rows, Shift+Tab
        // still wraps, and Escape still closes and returns focus to the bell. Dropping
        // the focus move altogether would leave a keyboard member stranded on the
        // trigger with the panel in a portal at the end of the body.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          panelRef.current?.focus();
        }}
        // Keep a comfortable gutter when the panel has to shift inward.
        collisionPadding={16}
        // Never taller than the space below the header, so the list scrolls
        // instead of running past the bottom of a short viewport.
        className="flex max-h-[min(28rem,var(--radix-popover-content-available-height,28rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg p-0 shadow-lg"
      >
        {/* The title and one quiet action. No rule under it: the first group's heading
            is the break. */}
        <div className="flex shrink-0 items-center justify-between gap-snug px-group pb-tight pt-cozy">
          <p className="text-lead font-semibold">Notifications</p>
          {/* WORDS, NO GLYPH (2026-11-28). The double tick is a chat app's "read"
              receipt, so beside the title it read as a status ("all read") rather than
              an action; Reddit, Klaviyo and Langdock set this as plain text. No spinner
              either: the dots clear the moment it is pressed. */}
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={isMarkingAll || unreadCount === 0}
            className="inline-flex min-h-9 items-center rounded-md border border-transparent px-snug text-body text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50"
          >
            Mark all as read
          </button>
        </div>

        {/* INSET ROWS, NO RULES BETWEEN THEM, the inbox's list: `px-snug` here and on
            the row puts every title 16px in, on the header's line. A THIN SCROLLBAR, as
            the list scrolls inside a page that scrolls, and the platform's full bar with
            arrows (Windows) was the heaviest line in the panel. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-snug pb-snug [scrollbar-width:thin]">
          {visible.length === 0 ? (
            <div className="px-group py-10 text-center text-body text-muted-foreground">
              You&apos;re all caught up.
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.key} aria-labelledby={`${headingId}-${group.key}`}>
                <h2
                  id={`${headingId}-${group.key}`}
                  className="px-snug pb-tight pt-snug text-meta font-medium text-muted-foreground"
                >
                  {group.label}
                </h2>
                <ul role="list" className="flex flex-col gap-px">
                  {group.rows.map((n) => (
                    <li key={n.id}>
                      <Link
                        // A removed contract would 404; the centre says so in place.
                        href={n.link && !n.target_missing ? n.link : '/notifications'}
                        onClick={() => handleSelect(n)}
                        className={notificationRowClass('gap-snug rounded-xl px-snug py-snug', needsReader(n))}
                      >
                        {/* The centre's row, term for term. The panel clamps the body
                            because it is 28rem tall at most and three long notifications
                            would fill it. */}
                        <NotificationRowBody notification={n} clampBody />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        {/* THE WAY TO THE WHOLE LIST. The panel holds twelve rows; the page holds the
            rest, the filters and the runs collapsed by card. Faire, Remote and Unity end
            their panels the same way. */}
        <div className="shrink-0 border-t p-snug">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex min-h-9 items-center rounded-lg px-snug text-body font-medium text-foreground transition-colors hover:bg-foreground/[0.035] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            See all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
