'use client';

// components/notifications/NotificationCenter.tsx
//
// Full-page NOTIFICATION CENTER list (Phase 4). Renders the caller's
// notifications, newest-first, with realtime updates via `useNotifications`
// (seeded from a server-provided initial list) and a "Mark all read" action.
// Each row links to its `link` and marks itself read on click.
//
// GROUPED BY AGE, NOT ONE FLAT RUN. Fifty rows of "3d ago" is a wall; the headings give
// it somewhere to break and a member somewhere to stop reading. The row contents and the
// bucketing both live in `notificationPresentation.tsx` — the bell renders the same rows.
//
// THE ORDER NEVER CHANGES WHEN SOMETHING IS READ, deliberately. Pinning unread to the
// top is the obvious way to show "what needs you", and it would mean the list reshuffles
// under the cursor on every click and rearranges itself wholesale on "Mark all read".
// Unread is carried by weight and the row tint instead, which is stable.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { BellOffIcon, CheckCheckIcon, LoaderCircleIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { navigateWithType } from '@/lib/motion/navigate';
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
import {
  groupNotificationsByAge,
  NOTIFICATION_TYPE_META,
  NotificationRowBody,
  notificationRowClass,
} from '@/components/notifications/notificationPresentation';

/**
 * Collapse consecutive notifications about the same thing into one row.
 *
 * Fifteen "New purchase request" rows on one card read as fifteen identical lines.
 * Rows of the same kind and title about the same listing (`subject_title`, 0126) that
 * sit next to each other become one row, the newest leading, with "+N more". Rows
 * without a subject are never merged: there is nothing to say they are the same.
 */
function collapseRuns(rows: readonly NotificationRow[]): { head: NotificationRow; rest: NotificationRow[] }[] {
  const runs: { head: NotificationRow; rest: NotificationRow[] }[] = [];
  for (const row of rows) {
    const last = runs[runs.length - 1];
    if (
      last &&
      row.subject_title &&
      last.head.subject_title === row.subject_title &&
      last.head.type === row.type &&
      last.head.title === row.title
    ) {
      last.rest.push(row);
      continue;
    }
    runs.push({ head: row, rest: [] });
  }
  return runs;
}

export function NotificationCenter({
  userId,
  initialNotifications,
  now,
}: {
  userId: string;
  initialNotifications: NotificationRow[];
  /**
   * The instant the page was rendered, ISO 8601, from the server.
   *
   * Passed in rather than read here so the server render and the first client render
   * agree on which age bucket each row falls in. See `groupNotificationsByAge`.
   */
  now: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const { notifications, unreadCount, markReadLocal, markAllReadLocal } =
    useNotifications(userId, initialNotifications);

  const [typeFilter, setTypeFilter] = useState<NotificationRow['type'] | 'ALL'>('ALL');

  /** Open a row (or a collapsed run): every notification in it is read by opening it. */
  function handleSelect(head: NotificationRow, rest: NotificationRow[] = []) {
    const unread = [head, ...rest].filter((row) => row.read_at === null);
    if (unread.length > 0) {
      for (const row of unread) markReadLocal(row.id);
      startTransition(async () => {
        await Promise.all(unread.map((row) => markNotificationRead(row.id)));
      });
    }
    // A removed contract is reported in the row; following it would land on a 404.
    if (head.link && !head.target_missing) {
      navigateWithType(router, head.link, 'nav-forward');
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
        icon={<HugeiconsIcon icon={BellOffIcon} className="size-6" aria-hidden />}
        title="No notifications yet"
        description="Offers, messages, trades, and sales updates will show up here."
        fill
      />
    );
  }

  // FILTER BY KIND, only when there is more than one kind to choose between. The rows
  // do not record which side of a deal the member was on, so the honest split is the
  // kind of thing that happened.
  const kinds = Array.from(new Set(notifications.map((row) => row.type)));
  const visible = typeFilter === 'ALL' ? notifications : notifications.filter((row) => row.type === typeFilter);
  const groups = groupNotificationsByAge(visible, now);

  return (
    <div className="space-y-group">
      {kinds.length > 1 ? (
        <div className="flex flex-wrap gap-snug" role="group" aria-label="Show notifications">
          {(['ALL', ...kinds] as const).map((kind) => {
            const selected = typeFilter === kind;
            const count = kind === 'ALL' ? notifications.length : notifications.filter((row) => row.type === kind).length;
            return (
              <Button
                key={kind}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={selected}
                className="aria-[pressed=true]:border-foreground aria-[pressed=true]:bg-accent aria-[pressed=true]:text-accent-foreground"
                onClick={() => setTypeFilter(kind)}
              >
                {kind === 'ALL' ? 'All' : `${NOTIFICATION_TYPE_META[kind].label}s`}
                <span className="tabular-nums text-muted-foreground">{count}</span>
              </Button>
            );
          })}
        </div>
      ) : null}
      {/* THE COUNT IS STATED, not left to be inferred from a disabled button. This row
          held nothing but "Mark all read", so the one figure a member opens this page
          for — how much is new — was reachable only by counting tinted rows. */}
      <div className="flex items-center justify-between gap-cozy">
        <p className="text-body text-muted-foreground" aria-live="polite">
          {unreadCount === 0
            ? 'You are all caught up.'
            : `${unreadCount} unread`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleMarkAll}
          disabled={isPending || unreadCount === 0}
        >
          {isPending ? (
            <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
          ) : (
            <HugeiconsIcon icon={CheckCheckIcon} aria-hidden />
          )}
          Mark all read
        </Button>
      </div>

      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`notifications-${group.key}`}>
          {/* NOT STICKY. A pinned heading would be the nicer thing on a long run, but
              the site header is fixed above this scroll container, so a `top-0` sticky
              lands underneath it — a heading that is present in the DOM and invisible
              on screen. Pinning it correctly means knowing the header's height here,
              which is exactly the coupling `scroll-mt-*` exists elsewhere to avoid. */}
          <h2
            id={`notifications-${group.key}`}
            className="mb-snug px-tight text-meta font-medium uppercase tracking-wide text-muted-foreground"
          >
            {group.label}
          </h2>
          <ul role="list" className="divide-y rounded-lg border">
            {collapseRuns(group.rows).map(({ head, rest }) => {
              const unread = [head, ...rest].some((row) => row.read_at === null);
              return (
                <li key={head.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(head, rest)}
                    className={notificationRowClass(
                      unread,
                      'gap-cozy px-group py-3.5',
                    )}
                  >
                    <NotificationRowBody
                      notification={unread ? { ...head, read_at: null } : head}
                      extra={
                        rest.length > 0 ? (
                          <span className="mt-0.5 block text-meta text-muted-foreground">
                            +{rest.length} more on this listing
                          </span>
                        ) : null
                      }
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
