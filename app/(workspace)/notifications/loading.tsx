// app/notifications/loading.tsx
//
// Activity list: heading, Mark all read, then text rows with an unread dot
// and a timestamp — no thumbnails or status pills.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  NotificationRowSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';

export default function NotificationsLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div className="min-w-0">
        <SectionHeaderSkeleton titleClassName="w-28" />
        <div className="space-y-4">
          <div className="flex justify-end">
            <Skeleton className="h-8 w-32 rounded-md" />
          </div>
          <div className="divide-y rounded-lg border">
            {Array.from({ length: 6 }, (_, index) => (
              <NotificationRowSkeleton key={index} />
            ))}
          </div>
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
