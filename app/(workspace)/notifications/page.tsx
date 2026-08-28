// app/notifications/page.tsx
//
// Full NOTIFICATION CENTER page (Phase 4). A Server Component that requires a
// session (redirecting to sign-in otherwise), fetches the caller's notifications
// via the RLS-scoped `listMyNotifications` action, and renders the realtime
// `NotificationCenter` client island seeded with that snapshot.

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { listMyNotifications } from '@/lib/actions/notifications';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
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

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in?redirectTo=/notifications');
  }

  const result = await listMyNotifications();

  return (
    <MarketplaceShell title="Notifications">
      <SectionHeader
        title="Activity"
        description="Your offers, messages, trades, and sales updates."
      />

      {!result.ok ? (
        <div className="mb-5">
          <SectionLoadError label="notifications" />
        </div>
      ) : (
        <div className="flex w-full flex-col">
          <NotificationCenter
            userId={user.id}
            initialNotifications={result.notifications}
          />
        </div>
      )}
    </MarketplaceShell>
  );
}
