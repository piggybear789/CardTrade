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

export const metadata = {
  title: 'Notifications · CardTrade',
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
    <MarketplaceShell title="Notifications" contentWidth="reading">
      <header className="mb-5 border-b border-border/70 pb-5">
        <h2 className="text-balance text-2xl font-bold tracking-[-0.035em] sm:text-3xl">
          Activity
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Your offers, messages, trades, and sales updates.
        </p>
      </header>

      <div className="flex w-full flex-col">
        <NotificationCenter
          userId={user.id}
          initialNotifications={initialNotifications}
        />
      </div>
    </MarketplaceShell>
  );
}
