'use client';

// components/account/AccountTabs.tsx
//
// Tab strip for the account settings page. Uses a `?tab=` query parameter
// rather than separate routes so both tabs share one page and one data fetch.

import Link from 'next/link';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'payments', label: 'Payments' },
] as const;

export function AccountTabs({ activeTab }: { activeTab: string }) {
  return (
    <nav aria-label="Account sections" className="mb-6 border-b">
      <ul className="flex gap-1">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <li key={tab.id}>
              <Link
                href={tab.id === 'profile' ? '/profile' : `/profile?tab=${tab.id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
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
