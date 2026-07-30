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

export const metadata = {
  title: 'Notifications · NoDitto',
};

// Reads the authenticated user's session and reflects live data, so it must
// render dynamically (never statically prerendered at build time).
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in?redirectTo=/notifications');
  }

  const result = await listMyNotifications();
  const initialNotifications = result.ok ? result.notifications : [];

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
      ) : null}

      <div className="flex w-full flex-col">
        <NotificationCenter
          userId={user.id}
          initialNotifications={initialNotifications}
        />
      </div>
    </MarketplaceShell>
  );
}
