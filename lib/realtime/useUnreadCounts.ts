'use client';

// lib/realtime/useUnreadCounts.ts
//
// Unread notifications and unread messages for the phone tab bar's badges.
//
// TWO HEAD COUNTS, NOT A SUBSCRIPTION. The desktop bell holds a live notification
// list because it renders one; the phone bar only needs two numbers, so it reads them
// with `count: 'exact', head: true` (no rows cross the wire) from the browser client,
// under the same RLS that scopes the bell. They refresh on every navigation and when
// the tab comes back into view, which is when a member looks at the bar.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import { createClient } from '@/lib/supabase/browser';

export interface UnreadCounts {
  notifications: number;
  messages: number;
}

const NONE: UnreadCounts = { notifications: 0, messages: 0 };

export function useUnreadCounts(userId: string | null): UnreadCounts {
  const pathname = usePathname();
  const [counts, setCounts] = useState<UnreadCounts>(NONE);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      const [notifications, messages] = await Promise.all([
        supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .is('read_at', null),
        // Mirrors the inbox's unread rule (`listMyConversations`): only a person's
        // message nags, and never your own.
        supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('kind', 'USER')
          .neq('sender_id', userId as string)
          .is('read_at', null),
      ]);
      if (cancelled) return;
      // A failed read keeps the last good figure rather than flashing zero.
      setCounts((prev) => ({
        notifications: notifications.error ? prev.notifications : (notifications.count ?? 0),
        messages: messages.error ? prev.messages : (messages.count ?? 0),
      }));
    }

    function onVisible() {
      if (document.visibilityState === 'visible') void load();
    }

    void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, pathname]);

  return userId ? counts : NONE;
}
