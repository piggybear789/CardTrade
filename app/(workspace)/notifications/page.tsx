// app/notifications/page.tsx
//
// Full NOTIFICATION CENTER page (Phase 4). A Server Component that requires a
// session (redirecting to sign-in otherwise), fetches the caller's notifications
// via the RLS-scoped `listMyNotifications` action, and renders the realtime
// `NotificationCenter` client island seeded with that snapshot.

import { redirect } from 'next/navigation';

import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { listMyNotifications } from '@/lib/actions/notifications';
import {
  NotificationCenter,
  NotificationsProvider,
  NotificationsToolbar,
} from '@/components/notifications/NotificationCenter';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import {
  SectionHeader,
  SectionLoadError,
} from '@/components/layout/SectionHeader';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata = {
  title: 'Notifications · NoDitto',
};

const SECTION = {
  title: 'Activity',
  description: 'Your offers, messages, trades, and sales updates.',
};

export default async function NotificationsPage() {
  // Together: the list resolves the caller through the same request-cached read.
  const [user, result] = await Promise.all([getCachedAuthUser(), listMyNotifications()]);
  if (!user) {
    redirect('/sign-in?redirectTo=/notifications');
  }

  return (
    <MarketplaceShell title="Notifications">
      {!result.ok ? (
        <>
          <SectionHeader {...SECTION} />
          <div className="mb-5">
            <SectionLoadError label="notifications" />
          </div>
        </>
      ) : (
        <NotificationsProvider userId={user.id} initialNotifications={result.notifications}>
          <SectionHeader {...SECTION} actions={<NotificationsToolbar />} />
          {/* `flex-1`/`min-h-0` so the empty state's `fill` has height to claim: the
              shell column hands its leftover space down only as far as the chain of
              flex children reaches, and this wrapper was where it stopped. */}
          <div className="flex min-h-0 w-full flex-1 flex-col">
            {/* `now` COMES FROM HERE, not from the client. The list groups rows by age,
                and a `new Date()` inside a client component runs once on the server and
                again in the browser — two different instants, so a row near a bucket
                boundary could land in one group during SSR and another on hydration.
                That is a structural mismatch, not a text one. */}
            <NotificationCenter now={new Date().toISOString()} />
          </div>
        </NotificationsProvider>
      )}
    </MarketplaceShell>
  );
}
