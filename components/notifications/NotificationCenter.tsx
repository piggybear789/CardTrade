'use client';

// components/notifications/NotificationCenter.tsx
//
// Full-page NOTIFICATION CENTER list (Phase 4). Renders the caller's
// notifications, newest-first, with realtime updates via `useNotifications`
// (seeded from a server-provided initial list) and a "Mark all read" action.
// Each row links to its `link` and marks itself read on click.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BellOff, CheckCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { navigateWithType } from '@/lib/motion/navigate';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/actions/notifications';
import {
  useNotifications,
  type NotificationRow,
} from '@/lib/realtime/useNotifications';

export function NotificationCenter({
  userId,
  initialNotifications,
}: {
  userId: string;
  initialNotifications: NotificationRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const { notifications, unreadCount, markReadLocal, markAllReadLocal } =
    useNotifications(userId, initialNotifications);

  function handleSelect(notification: NotificationRow) {
    if (notification.read_at === null) {
      markReadLocal(notification.id);
      startTransition(async () => {
        await markNotificationRead(notification.id);
      });
    }
    if (notification.link) {
      navigateWithType(router, notification.link, 'nav-forward');
    }
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

  // First-run empty only. The notifications page does not mount this on a
  // failed list, so `[]` here is never a load error.
  if (notifications.length === 0) {
    return (
      <EmptyState
        icon={<BellOff className="size-6" aria-hidden />}
        title="No Notifications Yet"
        description="Offers, messages, trades, and sales updates will show up here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleMarkAll}
          disabled={isPending || unreadCount === 0}
        >
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <CheckCheck aria-hidden />
          )}
          Mark all read
        </Button>
      </div>

      <ul role="list" className="divide-y rounded-lg border">
        {notifications.map((n) => {
          const unread = n.read_at === null;
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => handleSelect(n)}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent border border-transparent focus:outline-none focus-visible:border-gold/40 focus-visible:bg-accent',
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
                        'truncate text-body',
                        unread ? 'font-semibold' : 'font-medium',
                      )}
                    >
                      {n.title}
                    </span>
                    <span
                      className="shrink-0 text-meta text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {formatRelativeTime(n.created_at)}
                    </span>
                  </span>
                  {n.body && (
                    <span className="mt-0.5 block break-words text-body text-muted-foreground">
                      {n.body}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
