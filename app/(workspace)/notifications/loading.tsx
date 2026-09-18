// app/notifications/loading.tsx
//
// Activity list: heading, the unread count beside Mark all read, then age-bucketed
// groups of text rows with an unread dot and a timestamp — no thumbnails or status
// pills.
//
// GROUPED, NOT ONE FLAT RUN. This used to draw a single bordered list of six rows.
// `NotificationCenter` renders a `<section>` PER AGE BUCKET — an uppercase `text-meta`
// heading over its own `divide-y rounded-lg border` list — so a member with activity
// spanning a couple of days resolved into two bordered cards with a heading above each,
// where the placeholder had promised one. Two buckets are drawn here because that is
// the ordinary case for anyone with a live contract; the real labels are reserved so the
// headings do not change width on swap.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  NotificationRowSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

/** One age bucket: its heading, then its own bordered list. */
function NotificationGroupSkeleton({
  labelWidth,
  rows,
}: {
  labelWidth: string;
  rows: number;
}) {
  return (
    <section>
      {/* `mb-snug px-tight text-meta font-medium uppercase tracking-wide`, the real
          heading's own box. */}
      <TextLines
        className="mb-snug px-tight text-meta uppercase tracking-wide"
        widths={[labelWidth]}
      />
      <div className="divide-y rounded-lg border">
        {Array.from({ length: rows }, (_, index) => (
          <NotificationRowSkeleton key={index} />
        ))}
      </div>
    </section>
  );
}

export default function NotificationsLoading() {
  return (
    <MarketplaceShellSkeleton title="Notifications">
      {/* `flex min-h-0 flex-1 flex-col` so the resolved page's `EmptyState fill` has the
          same height to claim that this placeholder occupied. `notifications/page.tsx`
          wraps `NotificationCenter` in exactly this for exactly that reason: the shell
          hands its leftover space down only as far as the chain of flex children
          reaches, and a plain `min-w-0` div is where it stopped. Without it, a member
          with no activity saw a content-height stack become a full-column island. */}
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
        <SectionHeaderSkeleton titleClassName="w-28" />
        <div className="space-y-group">
          {/* `justify-between`, not `justify-end`. The real row states the unread count
              on the left — the one figure this page is opened for — so an end-aligned
              button alone left that line to appear from nothing. */}
          <div className="flex items-center justify-between gap-cozy">
            <TextLines className="text-body" widths={['w-20']} />
            {/* `size="sm"`: h-8 on touch, h-7 from md. */}
            <Skeleton className="h-8 w-32 shrink-0 rounded-md md:h-7" />
          </div>
          <NotificationGroupSkeleton labelWidth="w-28" rows={4} />
          <NotificationGroupSkeleton labelWidth="w-36" rows={2} />
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
