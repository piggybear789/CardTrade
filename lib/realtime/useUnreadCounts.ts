'use client';

// lib/realtime/useUnreadCounts.ts
//
// What is waiting on the member, as three numbers: unread notifications, unread
// messages, and offers whose next move is theirs. Drawn on the phone tab bar and the
// desktop rail, from ONE instance mounted in `WorkspaceChromeProvider`.
//
// HEAD COUNTS, NOT A SUBSCRIPTION. The desktop bell holds a live notification list
// because it renders one; the chrome only needs numbers, so it reads them with
// `count: 'exact', head: true` (no rows cross the wire) from the browser client, under
// the same RLS that scopes the bell. They refresh on every navigation and when the tab
// comes back into view, which is when a member looks at the chrome.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import { createClient } from '@/lib/supabase/browser';

export interface UnreadCounts {
  notifications: number;
  messages: number;
  /** Pending offers made by the other side — the member's move. */
  offers: number;
}

export const NO_UNREAD: UnreadCounts = { notifications: 0, messages: 0, offers: 0 };

export function useUnreadCounts(userId: string | null): UnreadCounts {
  const pathname = usePathname();
  const [counts, setCounts] = useState<UnreadCounts>(NO_UNREAD);

  useEffect(() => {
    if (!userId) return;
    const me = userId;
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      const [notifications, messages, offers] = await Promise.all([
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
          .neq('sender_id', me)
          .is('read_at', null),
        supabase
          .from('offers')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'PENDING')
          .neq('offered_by', me)
          .or(`seller_id.eq.${me},buyer_id.eq.${me}`),
      ]);
      if (cancelled) return;
      // A failed read keeps the last good figure rather than flashing zero.
      setCounts((prev) => ({
        notifications: notifications.error ? prev.notifications : (notifications.count ?? 0),
        messages: messages.error ? prev.messages : (messages.count ?? 0),
        offers: offers.error ? prev.offers : (offers.count ?? 0),
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

  return userId ? counts : NO_UNREAD;
}
