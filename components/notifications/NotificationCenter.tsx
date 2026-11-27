'use client';

// components/notifications/NotificationCenter.tsx
//
// Full-page NOTIFICATION CENTER list (Phase 4). Renders the caller's
// notifications, newest-first, with realtime updates via `useNotifications`
// (seeded from a server-provided initial list). Each row links to its `link` and
// marks itself read on click.
//
// The unread count and "Mark all as read" sit in the section header as
// `NotificationsToolbar`. `NotificationsProvider` gives the toolbar and the list one
// subscription: two `useNotifications` calls would keep two separate counts.
//
// GROUPED BY AGE, NOT ONE FLAT RUN. Fifty rows of "3d ago" is a wall; the headings give
// it somewhere to break and a member somewhere to stop reading. The row contents and the
// bucketing both live in `notificationPresentation.tsx` — the bell renders the same rows.
//
// THE ORDER NEVER CHANGES WHEN SOMETHING IS READ, deliberately. Pinning unread to the
// top is the obvious way to show "what needs you", and it would mean the list reshuffles
// under the cursor on every click and rearranges itself wholesale on "Mark all as read".
// Unread is carried by weight and the row tint instead, which is stable.

import { createContext, use, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { BellSlashIcon } from '@/components/ui/icons';
import { toast } from 'sonner';

import { navigateWithType } from '@/lib/motion/navigate';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/actions/notifications';
import {
  useNotifications,
  type NotificationRow,
  type UseNotificationsResult,
} from '@/lib/realtime/useNotifications';
import {
  groupNotificationsByAge,
  needsReader,
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

const NotificationsContext = createContext<UseNotificationsResult | null>(null);

function useNotificationsState(): UseNotificationsResult {
  const value = use(NotificationsContext);
  if (!value) {
    throw new Error('NotificationCenter and NotificationsToolbar must be inside NotificationsProvider');
  }
  return value;
}

export function NotificationsProvider({
  userId,
  initialNotifications,
  children,
}: {
  userId: string;
  initialNotifications: NotificationRow[];
  children: ReactNode;
}) {
  const value = useNotifications(userId, initialNotifications);
  return <NotificationsContext value={value}>{children}</NotificationsContext>;
}

/** The unread count and "Mark all as read", for the section header. */
export function NotificationsToolbar() {
  const { notifications, unreadCount, markAllReadLocal } = useNotificationsState();
  const [isPending, startTransition] = useTransition();

  if (notifications.length === 0) return null;

  function handleMarkAll() {
    markAllReadLocal();
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if (!result.ok) {
        toast.error('Could not mark notifications as read.');
      }
    });
  }

  return (
    <div className="flex items-center gap-cozy">
      {/* THE COUNT IS STATED, not left to be inferred from the disabled button: it is
          the one figure a member opens this page for. From `sm` only: on a phone it
          crowded the title, and the "Unread" chip under the header states it there. */}
      <p className="hidden whitespace-nowrap text-body text-muted-foreground sm:block" aria-live="polite">
        {unreadCount === 0 ? 'All caught up' : `${unreadCount} unread`}
      </p>
      {/* Words, no double tick, as in the header's panel (`NotificationBell`). */}
      <Button
        variant="secondary"
        size="sm"
        onClick={handleMarkAll}
        disabled={isPending || unreadCount === 0}
      >
        Mark all as read
      </Button>
    </div>
  );
}

export function NotificationCenter({
  now,
}: {
  /**
   * The instant the page was rendered, ISO 8601, from the server.
   *
   * Passed in rather than read here so the server render and the first client render
   * agree on which age bucket each row falls in. See `groupNotificationsByAge`.
   */
  now: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const { notifications, markReadLocal } = useNotificationsState();

  const [typeFilter, setTypeFilter] = useState<NotificationRow['type'] | 'ALL' | 'UNREAD'>('ALL');

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

  // First-run empty only. The notifications page does not mount this on a
  // failed list, so `[]` here is never a load error.
  if (notifications.length === 0) {
    return (
      <EmptyState
        icon={<Icon icon={BellSlashIcon} className="size-6" aria-hidden />}
        title="No notifications yet"
        description="Updates on your offers, sales and trades will show up here. Messages are in your inbox."
        fill
      />
    );
  }

  // FILTER BY KIND, only when there is more than one kind to choose between. The rows
  // do not record which side of a deal the member was on, so the honest split is the
  // kind of thing that happened.
  const kinds = Array.from(new Set(notifications.map((row) => row.type)));
  const unreadTotal = notifications.filter((row) => row.read_at === null).length;
  const matches = (row: NotificationRow, filter: typeof typeFilter) =>
    filter === 'ALL' ? true : filter === 'UNREAD' ? row.read_at === null : row.type === filter;
  // "Unread" is offered while there is something unread, plus while it is the
  // selection, so reading the last row does not pull the chip out from under the tap.
  const filters: (typeof typeFilter)[] = [
    'ALL',
    ...(unreadTotal > 0 || typeFilter === 'UNREAD' ? (['UNREAD'] as const) : []),
    ...(kinds.length > 1 ? kinds : []),
  ];
  const visible = notifications.filter((row) => matches(row, typeFilter));
  const groups = groupNotificationsByAge(visible, now);

  return (
    <div className="space-y-group">
      {filters.length > 1 ? (
        // ONE ROW THAT SCROLLS, not a wrapping block (2026-11-23). Five outlined
        // buttons wrapped onto two lines on a phone and pushed the list down. Slack,
        // Fresha and LinkedIn all use one sideways row of round chips, the selected one
        // filled. `-mx-4 px-4` (the shell's phone inset) lets the row run to the screen edge on a phone so
        // a cut-off chip reads as "more this way".
        <div
          className="-mx-4 flex gap-snug overflow-x-auto px-4 [-ms-overflow-style:none] sm:-mx-6 sm:px-6 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0 [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="Show notifications"
        >
          {filters.map((kind) => {
            const selected = typeFilter === kind;
            const count =
              kind === 'ALL'
                ? notifications.length
                : notifications.filter((row) => matches(row, kind)).length;
            const label =
              kind === 'ALL' ? 'All' : kind === 'UNREAD' ? 'Unread' : NOTIFICATION_TYPE_META[kind].plural;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={selected}
                onClick={() => setTypeFilter(kind)}
                className={cn(
                  // The filter chip every list uses (2026-11-28): `rounded-md`, because a
                  // control is never a pill, and a tint rather than an edge at rest.
                  'inline-flex h-9 shrink-0 touch-manipulation items-center gap-tight rounded-md border px-cozy text-body font-medium transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  selected
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-transparent bg-foreground/[0.05] text-foreground/75 hover:bg-foreground/[0.09] hover:text-foreground',
                )}
              >
                {label}
                <span className={cn('tabular-nums', selected ? 'text-background/70' : 'text-muted-foreground')}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {visible.length === 0 ? (
        <p className="px-tight py-section text-center text-body text-muted-foreground">
          Nothing unread. You&apos;re all caught up.
        </p>
      ) : null}
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
          {/* FLAT ON A PHONE, a bordered list from `md`. A box around every run, on a
              screen this narrow, spent 32px of width on borders and margins and made
              each age group read as a separate card. */}
          <ul role="list" className="-mx-4 divide-y border-y sm:-mx-6 md:mx-0 md:rounded-lg md:border">
            {collapseRuns(group.rows).map(({ head, rest }) => {
              const unread = [head, ...rest].some((row) => row.read_at === null);
              return (
                <li key={head.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(head, rest)}
                    className={notificationRowClass('gap-cozy px-group py-3.5', needsReader(head))}
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
