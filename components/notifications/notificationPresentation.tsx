// components/notifications/notificationPresentation.tsx
//
// How a notification LOOKS, shared by the header bell and the notification centre.
//
// The two surfaces had the row markup twice — the same title/timestamp
// row, the same clamped body — with the bell wrapping it in a `<Link>` and the centre
// in a `<button>`. So a change to either had to be made in both, and the surfaces
// already differed in ways nobody chose (the bell clamped the body to two lines, the
// centre let it run). The wrappers still differ, because they do different things; the
// contents are one component.
//
// THE TYPE IS NOW ON THE ROW. `notifications.type` — the enum every producer sets —
// was rendered nowhere at all, so a list of forty rows gave a member no way to scan for
// the sale among the messages. It is a glyph plus a text label, not a colour, because
// five categories cannot be told apart by hue and a badge per row would out-shout the
// titles.
//
// THERE IS NO "NEEDS ACTION" BLOCK, AND THAT IS A DELIBERATE REFUSAL. The design board
// asked for one, with copy naming the consequence of not acting. A notification row
// carries `{type, title, body, link}` and nothing else — no actionable flag, no
// deadline — so the only way to build that block would be to guess from the title text,
// or to add a column and revisit every producer that inserts one. Guessing is worse
// than not answering: a row filed under "needs action" that does not, or a deadline
// missing from the block that has one, is a promise this surface cannot keep.
//
// The question the board was really asking — what do I have to do, and by when — is
// answered where the answer is derived rather than guessed: the contract rooms' action
// card, the inspection countdown, and the next-step column now on every contract list.
// A notification is a pointer at those, so it says what happened and when, and links.

import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  BellIcon,
  HandCoinsIcon,
  MessageCircleIcon,
  RepeatIcon,
  Tag01Icon,
} from '@hugeicons/core-free-icons';

import type { NotificationRow } from '@/lib/realtime/useNotifications';
import type { Enums } from '@/lib/supabase/database.types';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type NotificationType = Enums<'notification_type'>;

/**
 * Glyph and label per notification kind.
 *
 * Icons are borrowed from the navigation the notification points AT —
 * `marketplace-nav-config` uses `HandCoinsIcon` for offers, `RepeatIcon` for trades,
 * `Tag01Icon` for sales — so a row and its destination carry the same mark.
 */
export const NOTIFICATION_TYPE_META: Record<
  NotificationType,
  { label: string; icon: IconSvgElement }
> = {
  OFFER: { label: 'Offer', icon: HandCoinsIcon },
  MESSAGE: { label: 'Message', icon: MessageCircleIcon },
  TRADE: { label: 'Trade', icon: RepeatIcon },
  SALE: { label: 'Sale', icon: Tag01Icon },
  SYSTEM: { label: 'NoDitto', icon: BellIcon },
};

/** Fall back rather than crash on a kind added by a migration this build predates. */
function metaFor(type: string) {
  return (
    NOTIFICATION_TYPE_META[type as NotificationType] ??
    NOTIFICATION_TYPE_META.SYSTEM
  );
}

/**
 * The row's own SURFACE — unread, hover and focus — shared by the bell and the centre.
 *
 * Here rather than in each caller for the reason this module exists: the two had the
 * three states written out twice and identically, so the next change to any of them was
 * a change in two places. The callers still own their spacing, which is the part that
 * legitimately differs (the panel's rows are tighter than the page's).
 *
 * THE UNREAD WASH IS THE ACCENT TINT, AND IT STAYS VIOLET. It was briefly swapped for
 * ink at 5% on the grounds that a lilac band on every unread row made the panel's
 * dominant colour a tint. Reverted on look: `--foreground` is a plum-black, so a few
 * percent of it over white lands on a near-perfect neutral — which, surrounded by the
 * lilac page, card and hover states this app is built from, reads GREEN. Simultaneous
 * contrast, and an unread row that looks faintly green is worse than one that looks
 * faintly violet, because green means something else in this palette (`--trust`).
 *
 * A wash belongs to the family it sits in. `--accent` is the pastel violet SURFACE
 * token, which is exactly what this is, and globals.css allows the hue to TINT freely —
 * the rule it is under governs borders.
 *
 * The one thing the ink version was right about is recorded rather than fixed: because
 * unread and hover are two alphas of one token, a hovered unread row and a hovered read
 * row land on the same value, so the wash stops distinguishing them under the cursor.
 * The semibold title and the `sr-only` "unread" still do, which is why that is
 * acceptable — colour was never carrying this state alone.
 *
 * @param unread Whether the row's notification is unread.
 * @param layout The caller's own spacing and gap utilities.
 */
export function notificationRowClass(unread: boolean, layout: string) {
  return cn(
    'flex w-full items-start border border-transparent text-left transition-colors',
    'hover:bg-accent focus:outline-none focus-visible:border-iris focus-visible:bg-accent',
    unread && 'bg-accent/40',
    layout,
  );
}

/**
 * Everything inside a notification row.
 *
 * PHRASING CONTENT ONLY — every element is a `<span>` with layout classes. The centre
 * wraps this in a `<button>`, whose content model forbids `<div>` and `<p>`, so a block
 * element here would be invalid HTML on one of the two callers.
 */
export function NotificationRowBody({
  notification,
  clampBody = false,
}: {
  notification: NotificationRow;
  /** The bell's panel clamps to two lines; the full-page centre does not. */
  clampBody?: boolean;
}) {
  const unread = notification.read_at === null;
  const meta = metaFor(notification.type);

  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-snug">
          <span
            className={cn(
              'flex min-w-0 items-baseline gap-tight',
              unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {/* `self-center` so the glyph optically centres on the cap height of the
                title beside it rather than sitting on the baseline. */}
            <HugeiconsIcon
              icon={meta.icon}
              className="size-3.5 shrink-0 self-center text-muted-foreground"
              aria-hidden
            />
            <span className="sr-only">
              {meta.label}
              {unread ? ', unread' : ''}:{' '}
            </span>
            <span className="truncate text-body">{notification.title}</span>
          </span>
          <span
            className="shrink-0 text-meta text-muted-foreground"
            suppressHydrationWarning
          >
            {formatRelativeTime(notification.created_at)}
          </span>
        </span>
        {notification.body ? (
          <span
            className={cn(
              'mt-0.5 block break-words text-body text-muted-foreground',
              clampBody && 'line-clamp-2',
            )}
          >
            {notification.body}
          </span>
        ) : null}
      </span>
    </>
  );
}

/** One dated run of notifications. */
export interface NotificationGroup {
  /** Stable React key. */
  key: string;
  label: string;
  rows: NotificationRow[];
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The buckets, in the order they appear. Widening spans, newest first.
 *
 * MEASURED IN AGE, NOT IN CALENDAR DAYS, and that is not laziness about "Today" and
 * "Yesterday". A calendar day needs a timezone; the server renders this list and has
 * only its own, so a member in Australia would be shown "Today" against a boundary
 * struck in UTC — wrong for a third of every day, and wrong in a way that looks like a
 * bug in the timestamps rather than in the heading. Age is the same number everywhere.
 */
const BUCKETS: readonly { key: string; label: string; maxAgeMs: number }[] = [
  { key: 'day', label: 'Last 24 hours', maxAgeMs: DAY_MS },
  { key: 'week', label: 'Earlier this week', maxAgeMs: 7 * DAY_MS },
  { key: 'month', label: 'Earlier this month', maxAgeMs: 30 * DAY_MS },
  { key: 'older', label: 'Older', maxAgeMs: Number.POSITIVE_INFINITY },
];

/**
 * Split notifications into dated runs, preserving the newest-first order within each.
 *
 * @param rows   Already sorted newest-first by the realtime hook.
 * @param nowIso The instant to measure against, supplied by the SERVER so the first
 *   client render lands on the same buckets. Deriving it here with `new Date()` would
 *   put a different `now` on each side of hydration, and a group that exists on one
 *   side and not the other is a structural mismatch `suppressHydrationWarning` cannot
 *   paper over — unlike the per-row relative timestamps, which it does.
 *
 * Empty buckets are dropped, so a member with three notifications from this morning
 * sees one heading rather than four.
 */
export function groupNotificationsByAge(
  rows: readonly NotificationRow[],
  nowIso: string,
): NotificationGroup[] {
  const now = new Date(nowIso).getTime();
  const reference = Number.isFinite(now) ? now : Date.now();

  const groups: NotificationGroup[] = BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    rows: [],
  }));

  for (const row of rows) {
    const created = new Date(row.created_at).getTime();
    // An unparseable or future timestamp lands in the newest bucket rather than
    // anywhere surprising: a row is never dropped from a list of things that happened.
    const age = Number.isFinite(created) ? Math.max(reference - created, 0) : 0;
    const index = BUCKETS.findIndex((bucket) => age < bucket.maxAgeMs);
    groups[index === -1 ? BUCKETS.length - 1 : index].rows.push(row);
  }

  return groups.filter((group) => group.rows.length > 0);
}
