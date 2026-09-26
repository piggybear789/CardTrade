'use client';

// components/notifications/NotificationBell.tsx
//
// The in-app NOTIFICATION CENTER entry point for the site header (Phase 4). A
// bell icon with an unread-count badge that opens a lightweight popover panel
// listing recent notifications. Each row shows the title, optional body, a
// relative timestamp, and an unread tint; clicking a row marks it read and
// navigates to its `link`. A "Mark all read" action clears every unread badge.
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

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { BellIcon, CheckCheckIcon, LoaderCircleIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import {
  NotificationRowBody,
  notificationRowClass,
} from '@/components/notifications/notificationPresentation';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
  const [isPending, startTransition] = useTransition();
  const [notifications, setNotifications] = useState(initialNotifications);
  const panelRef = useRef<HTMLDivElement>(null);
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

  function markAllReadLocal() {
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) =>
        notification.read_at === null ? { ...notification, read_at: readAt } : notification,
      ),
    );
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    startTransition(async () => {
      const result = await listMyNotifications(PANEL_LIMIT);
      if (result.ok) setNotifications(result.notifications);
    });
  }

  function handleSelect(notification: NotificationRow) {
    // Optimistically mark read, persist best-effort, then navigate.
    if (notification.read_at === null) {
      markReadLocal(notification.id);
      startTransition(async () => {
        const res = await markNotificationRead(notification.id);
        if (!res.ok) {
          toast.error('Could not mark notification as read.');
        }
      });
    }
    setOpen(false);
  }

  function handleMarkAll() {
    markAllReadLocal();
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if (!result.ok) {
        toast.error('Could not mark notifications as read.');
      }
    });
  }

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);
  const visible = notifications.slice(0, PANEL_LIMIT);

  return (
      <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications'
        }
        className="relative inline-flex size-10 touch-manipulation items-center justify-center rounded-md text-mist/75 transition-colors hover:bg-white/10 hover:text-mist border border-transparent focus:outline-none focus-visible:border-iris"
      >
        <HugeiconsIcon icon={BellIcon} className="size-5" aria-hidden />
        {unreadCount > 0 ? (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-tight text-meta font-semibold leading-none text-destructive-foreground"
            aria-hidden
          >
            {badgeLabel}
          </span>
        ) : null}
      </PopoverTrigger>

      <PopoverContent
        ref={panelRef}
        aria-label="Notifications"
        align="end"
        sideOffset={8}
        // `-1` so the panel can take focus itself without entering the tab order.
        tabIndex={-1}
        // FOCUS THE PANEL, NOT THE FIRST CONTROL IN IT. Radix's default lands on
        // "Mark all read" — a bulk action, wearing the violet focus edge, before the
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
        <div className="flex shrink-0 items-center justify-between gap-snug border-b px-group py-2.5">
          <p className="text-body font-semibold">Notifications</p>
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={isPending || unreadCount === 0}
            className="inline-flex min-h-9 items-center gap-tight rounded-md border border-transparent px-snug text-body text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:border-iris disabled:pointer-events-none disabled:opacity-50"
          >
            {isPending ? (
              <HugeiconsIcon icon={LoaderCircleIcon} className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <HugeiconsIcon icon={CheckCheckIcon} className="size-3.5" aria-hidden />
            )}
            Mark all read
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {visible.length === 0 ? (
            <div className="px-group py-10 text-center text-body text-muted-foreground">
              You&apos;re all caught up.
            </div>
          ) : (
            <ul role="list" className="divide-y">
              {visible.map((n) => {
                const unread = n.read_at === null;
                return (
                  <li key={n.id}>
                    <Link
                      href={n.link || '/notifications'}
                      onClick={() => handleSelect(n)}
                      className={notificationRowClass(
                        unread,
                        'gap-snug px-group py-cozy',
                      )}
                    >
                      {/* The centre's row, term for term. The panel clamps the body
                          because it is 28rem tall at most and three long notifications
                          would fill it. */}
                      <NotificationRowBody notification={n} clampBody />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
