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

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';
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
  const containerRef = useRef<HTMLDivElement | null>(null);

  const {
    notifications,
    unreadCount,
    markReadLocal,
    markAllReadLocal,
  } = useNotifications(userId, initialNotifications);

  // Close the panel on outside click or Escape.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications'
        }
        className="relative inline-flex size-9 touch-manipulation items-center justify-center rounded-md text-parchment/75 transition-colors hover:bg-white/10 hover:text-parchment focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian"
      >
        <Bell className="size-5" aria-hidden />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white"
            aria-hidden
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={isPending || unreadCount === 0}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <CheckCheck className="size-3.5" aria-hidden />
              )}
              Mark all read
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
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
                          'flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-accent focus:outline-none focus-visible:bg-accent',
                          unread && 'bg-accent/40',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-1.5 size-2 shrink-0 rounded-full',
                            unread ? 'bg-red-500' : 'bg-transparent',
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
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatRelativeTime(n.created_at)}
                            </span>
                          </span>
                          {n.body && (
                            <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
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
        </div>
      )}
    </div>
  );
}
