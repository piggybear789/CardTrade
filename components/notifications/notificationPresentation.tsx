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
// carries what happened (`type`, `title`, `body`, `link`) and, since 0126, what it was
// about (the card, its photo, the other member, the amount) — but no actionable flag
// and no deadline, so that block could only be built by guessing from the title text.
// Guessing is worse than not answering: a row filed under "needs action" that does not,
// or a deadline missing from the block that has one, is a promise this surface cannot
// keep.
//
// The question the board was really asking — what do I have to do, and by when — is
// answered where the answer is derived rather than guessed: the contract rooms' action
// card, the inspection countdown, and the next-step column now on every contract list.
// A notification is a pointer at those, so it says what happened and when, and links.

import type * as React from 'react';
import { Icon, type IconGlyph } from '@/components/ui/icon';
import {
  ArrowsLeftRightIcon,
  BellIcon,
  ChatCircleIcon,
  HandCoinsIcon,
  TagIcon,
} from '@/components/ui/icons';

import { needsViewer } from '@/components/account/ContractRow';
import type { NotificationRow } from '@/lib/realtime/useNotifications';
import type { Enums } from '@/lib/supabase/database.types';
import { formatAge, formatMoney, itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';

type NotificationType = Enums<'notification_type'>;

/**
 * Glyph and label per notification kind.
 *
 * Icons are borrowed from the navigation the notification points AT —
 * `marketplace-nav-config` uses `HandCoinsIcon` for offers, `ArrowsLeftRightIcon` for trades,
 * `TagIcon` for sales — so a row and its destination carry the same mark.
 */
export const NOTIFICATION_TYPE_META: Record<
  NotificationType,
  {
    label: string;
    /**
     * The filter chip's label. Spelled out rather than `${label}s`, which made the
     * SYSTEM chip read "NoDittos".
     */
    plural: string;
    icon: IconGlyph;
  }
> = {
  OFFER: { label: 'Offer', plural: 'Offers', icon: HandCoinsIcon },
  MESSAGE: { label: 'Message', plural: 'Messages', icon: ChatCircleIcon },
  TRADE: { label: 'Trade', plural: 'Trades', icon: ArrowsLeftRightIcon },
  SALE: { label: 'Sale', plural: 'Sales', icon: TagIcon },
  SYSTEM: { label: 'NoDitto', plural: 'Updates', icon: BellIcon },
};

/** Fall back rather than crash on a kind added by a migration this build predates. */
function metaFor(type: string) {
  return (
    NOTIFICATION_TYPE_META[type as NotificationType] ??
    NOTIFICATION_TYPE_META.SYSTEM
  );
}

/**
 * The row's own SURFACE — hover and focus — shared by the bell and the centre.
 *
 * Here rather than in each caller for the reason this module exists: the two had the
 * states written out twice and identically, so the next change to any of them was
 * a change in two places. The callers still own their spacing, which is the part that
 * legitimately differs (the panel's rows are tighter than the page's).
 *
 * NO UNREAD WASH. A grey tint on every unread row made a list of new things look
 * disabled, and the hover state could not be told from it, and most rows in a busy list
 * are unread, so a wash there marks nearly everything. Unread is carried inside the row
 * instead: the `iris` dot, the semibold title and the `sr-only` "unread"
 * (`NotificationRowBody`).
 *
 * A ROW WAITING ON YOU IS WASHED (2026-11-28): the amber of "your move", the same hue as
 * its disc and its step line, so the rows that ask something of the reader read as a
 * different kind of row at a glance, not as a slightly bolder one. It follows the
 * contract's live plan (`needsReader`), so it clears as soon as the step is taken.
 *
 * Hover is the inbox's own step, a 3.5% tint of the ink, so a row reads the same in the
 * bell, on this page and in the inbox; a washed row darkens its wash instead. The bell
 * rounds the row (`rounded-xl`).
 *
 * @param layout The caller's own spacing, gap and radius utilities.
 * @param yours Whether the row's contract is waiting on the reader (`needsReader`).
 */
export function notificationRowClass(layout: string, yours = false) {
  return cn(
    // CENTRED, so the kind's disc and the card's photo sit on one line through the
    // middle of the row however many lines the text between them takes (2026-11-28).
    'flex w-full items-center border border-transparent text-left transition-colors',
    'focus:outline-none focus-visible:border-ring',
    yours
      ? 'bg-action/[0.16] hover:bg-action/[0.26] focus-visible:bg-action/[0.26]'
      : 'hover:bg-foreground/[0.035] focus-visible:bg-foreground/[0.035]',
    layout,
  );
}

/**
 * Whether the contract a row links to is waiting on the person reading it: its live
 * step (`contract_move`, derived by the server) by the contract lists' rule
 * (`needsViewer`). A row that links nowhere, or to a contract that has moved on, never is.
 */
export function needsReader(notification: NotificationRow): boolean {
  return needsViewer(notification.contract_move ?? null);
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
  extra,
}: {
  notification: NotificationRow;
  /** The bell's panel clamps to two lines; the full-page centre does not. */
  clampBody?: boolean;
  /** A trailing line, e.g. "+3 more on this listing" for a collapsed run. */
  extra?: React.ReactNode;
}) {
  const unread = notification.read_at === null;
  const meta = metaFor(notification.type);
  const thumb = itemImageUrl(notification.image_path);
  // WHO, WHAT, HOW MUCH (0126). A generic body ("A buyer wants to purchase from your
  // listing") said the same thing on every row; with the context columns the row names
  // the other member, the card and the amount instead. A row whose producer named none
  // takes the card and the member from the sale or trade it links to
  // (`lib/notifications/linkedContract.ts`); one that links elsewhere keeps its body.
  const context = [
    notification.actor_name,
    notification.subject_title,
    notification.amount_cents != null && notification.currency
      ? formatMoney(notification.amount_cents, notification.currency)
      : null,
  ].filter(Boolean);
  const line = context.length > 0 ? context.join(' · ') : notification.body;
  // WHAT NEEDS YOU (2026-11-28). The contract the row links to, as it stands now
  // (`contract_move`, derived by the server from the same plan as the contract room),
  // and the contract lists' rule for whose move counts as yours (`needsViewer`). A row
  // waiting on the reader takes the amber of "your move" on its disc and says the step
  // in that amber's dark ink, above the who-and-which note; every other row stays grey.
  // Never read from the title: a notification about a trade that has since completed
  // asks for nothing.
  const move = notification.contract_move ?? null;
  const yours = needsReader(notification);

  // THE KIND LEADS THE ROW, THE CARD TRAILS IT (2026-11-23). Slack, LinkedIn and Doji
  // open each activity row with one fixed-size mark and put the subject's picture at
  // the end. Here the kind was a 14px glyph wedged between the unread dot and the title,
  // and the card photo led only the rows that had one, so titles started at two
  // different x positions down one list. The medallion is on every row, so every title
  // lines up; the unread dot rides on it. Disc and photo are one size, 40px, so they
  // share a centre line.
  return (
    <>
      <span className="relative shrink-0" aria-hidden>
        <span
          className={cn(
            'grid size-10 place-items-center rounded-full',
            yours ? 'bg-action text-action-foreground' : 'bg-muted text-foreground',
          )}
        >
          <Icon icon={meta.icon} className="size-4" />
        </span>
        {unread ? (
          <span className="absolute -left-0.5 -top-0.5 size-2.5 rounded-full bg-iris ring-2 ring-background" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-snug">
          {/* READ ROWS AT REGULAR WEIGHT (2026-11-28). Medium against semibold was a
              100-weight step nobody could see, so a read row looked unread minus its dot;
              Jira, Instagram and TikTok set a read row in the body's own weight. */}
          <span className={cn('min-w-0 truncate text-body', unread ? 'font-semibold' : 'font-normal')}>
            <span className="sr-only">
              {meta.label}
              {unread ? ', unread' : ''}:{' '}
            </span>
            {notification.title}
          </span>
          {/* "7h", not "7h ago", as in the inbox (`formatAge`). */}
          <span
            className="shrink-0 text-meta tabular-nums text-muted-foreground"
            suppressHydrationWarning
          >
            {formatAge(notification.created_at)}
          </span>
        </span>
        {yours && move ? (
          // The step, in the plan's own words ("Accept what you received").
          <span className="mt-0.5 block truncate text-body font-medium text-action-foreground">
            <span className="sr-only">Your move: </span>
            {move.label}
          </span>
        ) : null}
        {line ? (
          <span
            className={cn(
              'mt-0.5 block text-body text-muted-foreground',
              // Who and which card is one line, cut short rather than wrapped: a long
              // listing title broke onto a second line and read as two notes. A
              // sentence (a row with no subject) still gets its two lines here.
              context.length > 0 ? 'truncate' : cn('break-words', clampBody && 'line-clamp-2'),
            )}
          >
            {line}
          </span>
        ) : null}
        {extra}
        {notification.target_missing ? (
          // Said in place, because following the link would land on a 404: the sale
          // or trade it pointed at has been removed or is no longer yours to open.
          <span className="mt-1 block w-fit rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-meta font-medium text-foreground/75">
            No longer available
          </span>
        ) : null}
      </span>
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- a 40px Supabase thumbnail; next/image adds nothing here.
        <img
          src={thumb}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          className="size-10 shrink-0 rounded-lg object-cover object-top outline outline-1 -outline-offset-1 outline-foreground/[0.08]"
        />
      ) : null}
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
  // "Last 7 days", not "Earlier this week": an age bucket named after a calendar span
  // headed September items on 9 October as "this month".
  { key: 'week', label: 'Last 7 days', maxAgeMs: 7 * DAY_MS },
  { key: 'month', label: 'Last 30 days', maxAgeMs: 30 * DAY_MS },
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
