'use client';

// components/account/AccountTabs.tsx
//
// Tab strip across the account-area routes (Req 1.2).
//
// A client component only because it needs `usePathname` to mark the current
// route. Marking is `aria-current="page"` rather than styling alone, so the
// active tab is announced rather than merely looking different.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

interface AccountTab {
  href: string;
  label: string;
}

/**
 * The account-area routes, in the order they are presented.
 *
 * Deliberately short: this strip is for settings-level surfaces the Member
 * manages, not the transactional sections (sales, purchases, offers) that live in
 * the workspace rail.
 */
const TABS: readonly AccountTab[] = [
  { href: '/profile', label: 'Profile' },
  { href: '/profile/payouts', label: 'Payouts' },
];

export function AccountTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Account sections" className="mb-6">
      <ul className="flex flex-wrap items-center gap-2">
        {TABS.map((tab) => {
          // Exact match, so /profile does not also light up on /profile/payouts.
          const active = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center rounded-full px-4 py-1.5 text-sm font-medium transition-colors active:opacity-70',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
