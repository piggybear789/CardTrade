'use client';

// components/notifications/NotificationBell.tsx
//
// The in-app NOTIFICATION CENTER entry point for the site header (Phase 4). A
// bell icon with an unread-count badge that opens a lightweight popover panel
// listing recent notifications. Each row shows the title, optional body, a
// relative timestamp, and an unread dot; clicking a row marks it read and
// navigates to its `link`. A "Mark all read" action clears every unread badge.
//
// Live data comes from `useNotifications`, seeded with a server-provided initial
// list so the first paint is populated even before the realtime channel opens.
// Mark-read state is updated optimistically in the hook, then persisted via the
// RLS-scoped server actions.
//
// The panel is a Popover rather than a hand-placed absolute box: the bell is not
// the last control in the header, so anchoring a panel to its edge pushes the
// panel off the opposite side of a narrow viewport. The popover keeps itself
// inside the viewport, and portals out of the header's backdrop filter.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/actions/notifications';
import {
  useNotifications,
  type NotificationRow,
} from '@/lib/realtime/useNotifications';

/** Cap the number of rows shown in the dropdown panel. */
const PANEL_LIMIT = 12;

export interface NotificationBellProps {
  /** The signed-in user's id (drives the realtime filter). */
  userId: string;
  /** Server-fetched initial notifications (newest-first) to seed the panel. */
  initialNotifications: NotificationRow[];
}

export function NotificationBell({
  userId,
  initialNotifications,
}: NotificationBellProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const {
    notifications,
    unreadCount,
    markReadLocal,
    markAllReadLocal,
  } = useNotifications(userId, initialNotifications);

  function handleSelect(notification: NotificationRow) {
    // Optimistically mark read, persist best-effort, then navigate.
    if (notification.read_at === null) {
      markReadLocal(notification.id);
      startTransition(async () => {
        await markNotificationRead(notification.id);
      });
    }
    setOpen(false);
    if (notification.link) {
      router.push(notification.link);
    }
  }

  function handleMarkAll() {
    markAllReadLocal();
    startTransition(async () => {
      await markAllNotificationsRead();
    });
  }

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);
  const visible = notifications.slice(0, PANEL_LIMIT);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications'
        }
        className="relative inline-flex size-10 touch-manipulation items-center justify-center rounded-md text-parchment/75 transition-colors hover:bg-white/10 hover:text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian"
      >
        <Bell className="size-5" aria-hidden />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground"
            aria-hidden
          >
            {badgeLabel}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent
        aria-label="Notifications"
        align="end"
        sideOffset={8}
        // Keep a comfortable gutter when the panel has to shift inward.
        collisionPadding={16}
        // Never taller than the space below the header, so the list scrolls
        // instead of running past the bottom of a short viewport.
        className="flex max-h-[min(28rem,var(--radix-popover-content-available-height,28rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg p-0 shadow-lg"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={isPending || unreadCount === 0}
            className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <CheckCheck className="size-3.5" aria-hidden />
            )}
            Mark all read
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {visible.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </div>
          ) : (
            <ul role="list" className="divide-y">
              {visible.map((n) => {
                const unread = n.read_at === null;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(n)}
                      className={cn(
                        'flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-accent focus:outline-none focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        unread && 'bg-accent/40',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1.5 size-2 shrink-0 rounded-full',
                          unread ? 'bg-destructive' : 'bg-transparent',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              'truncate text-sm',
                              unread ? 'font-semibold' : 'font-medium',
                            )}
                          >
                            {n.title}
                          </span>
                          <span
                            className="shrink-0 text-xs text-muted-foreground"
                            suppressHydrationWarning
                          >
                            {formatRelativeTime(n.created_at)}
                          </span>
                        </span>
                        {n.body && (
                          <span className="mt-0.5 line-clamp-2 block break-words text-xs text-muted-foreground">
                            {n.body}
                          </span>
                        )}
                      </span>
                    </button>
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
