// app/(workspace)/messages/(thread)/layout.tsx
//
// The frame around an open conversation: the workspace shell, the inbox pane beside the
// thread from `lg`, and the thread pane itself (`children` — the `[id]` page).
//
// WHY THIS IS A LAYOUT AND NOT PART OF THE PAGE. All of it used to be rendered by
// `[id]/page.tsx`, on the reasoning that the list was a static set of links, so a layout
// would only save a refetch. It saved far more than that. A dynamic segment's subtree is
// keyed by its param, so `/messages/A` -> `/messages/B` unmounted and rebuilt everything
// the page drew: the shell, the pane (back to the top of its scroll) and the thread, and
// the server re-ran the whole inbox query to draw the list it had just thrown away. That
// is what read as the page refreshing on every click.
//
// A layout is not re-rendered by a navigation between the routes beneath it. So the
// shell and the pane stay mounted, the server renders only the thread (auth plus one
// conversation read), and the pane is kept current on the client instead
// (`InboxProvider`), which also lets it draw the clicked thread before the server
// answers (`ThreadPane`). The list is fetched here once, when the route is entered.
//
// IN ITS OWN ROUTE GROUP for the same reason `(inbox)` is. `/messages` is a different
// shape — the full-width list — and a layout at `messages/` would wrap it as well. Each
// group owns one shape and neither can reach the other.
//
// Fetched without a Suspense boundary, deliberately: a client navigation INTO this
// route waits for the list, but layouts and pages render in parallel, so it waits for
// the slower of the list and the thread rather than for both in sequence as it used to.
// Navigations within the route never wait for it at all.

import type { ReactNode } from 'react';

import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { InboxProvider } from '@/components/messages/InboxProvider';
import { InboxRail, InboxUnreadLabel } from '@/components/messages/InboxRail';
import { InboxTwoPane } from '@/components/messages/InboxTwoPane';
import { ThreadPane } from '@/components/messages/ThreadPane';
import { listMyConversations } from '@/lib/actions/messages';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

export default async function ConversationLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // Taken BEFORE the reads, so the snapshot never claims to be newer than its data. The
  // pane's catch-up query starts from this instant (less an overlap).
  const snapshotAt = new Date().toISOString();

  // `listMyConversations` resolves the caller through the same request-cached auth read,
  // so the pair costs one auth round trip.
  const [user, inbox] = await Promise.all([getCachedAuthUser(), listMyConversations()]);

  return (
    // `fill`: the two-pane inbox caps its own content — a fixed-width list pane and a
    // capped reading measure — so the shell's 90rem cap only left dead space beside it.
    <MarketplaceShell title="Messages" flush fill contentOwnsBottomPadding>
      {user ? (
        <InboxProvider
          currentUserId={user.id}
          // A FAILED LIST MUST NOT COST THE READER THEIR THREAD. The list is secondary
          // navigation for a page whose subject loads on its own, so a failure degrades
          // to an empty pane rather than an error page.
          initialConversations={inbox.ok ? inbox.conversations : null}
          snapshotAt={snapshotAt}
        >
          <InboxTwoPane
            countLabel={<InboxUnreadLabel />}
            list={<InboxRail />}
            detail={<ThreadPane>{children}</ThreadPane>}
          />
        </InboxProvider>
      ) : (
        // Signed out. The proxy redirects before this renders, and the page redirects
        // with the exact `redirectTo`; this branch only declines to draw an inbox for
        // nobody.
        children
      )}
    </MarketplaceShell>
  );
}
