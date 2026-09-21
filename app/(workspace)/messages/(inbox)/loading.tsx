// app/(workspace)/messages/(inbox)/loading.tsx
//
// Inbox list: same SectionHeader as Saved / Purchases, grouped card on desktop.
//
// IN ITS OWN ROUTE GROUP, and that is load-bearing — the same reason
// `app/(workspace)/(home)/loading.tsx` is. This file used to sit at
// `messages/loading.tsx`, beside its `page.tsx`, which made it the Suspense fallback for
// the WHOLE `messages` subtree rather than for this page. `[id]` is in that subtree, and
// a dynamic segment's own `loading.tsx` is never warm for a param you have not visited,
// so on every `/messages/A` -> `/messages/B` click Next fell back here and drew a
// full-width card of nine wide inbox rows in front of a two-pane conversation room.
//
// `(inbox)` scopes it to `/messages`. The `messages/loading.tsx` slot now holds the
// thread shape, which is what its descendants actually are.

import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import {
  InboxRowSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';
import { MobileList } from '@/components/ui/mobile-list';
import { cn } from '@/lib/utils';

/**
 * Six rows filled a phone and stopped ~185px short of a desktop fold: the wide
 * inbox row is 80px (`p-group` around a 48px avatar), and the content column has
 * roughly 667px under the section header at 1440x900. The extra rows are drawn
 * from `md` only — see the two-count note on `ContractCardListSkeleton`.
 */
const PHONE_ROWS = 6;
const DESKTOP_ROWS = 9;

export default function MessagesLoading() {
  return (
    <MarketplaceShellSkeleton title="Messages">
      {/* No wrapper div — see the note in `saved/loading.tsx`. */}
      <SectionHeaderSkeleton titleClassName="w-24" descriptionClassName="w-40" />
      {/* `MobileList` itself rather than a hand-copied class string. The copy that was
          here had drifted by a `md:shadow-market`, and borrowing the component is the
          only way the two cannot drift again. */}
      <MobileList variant="sheet">
        {Array.from({ length: DESKTOP_ROWS }, (_, index) => (
          <li
            key={index}
            className={cn(index >= PHONE_ROWS && 'max-md:hidden')}
          >
            <InboxRowSkeleton />
          </li>
        ))}
      </MobileList>
    </MarketplaceShellSkeleton>
  );
}
