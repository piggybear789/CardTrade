'use client';

// components/account/AccountTabs.tsx

import Link from 'next/link';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'verification', label: 'Verification' },
  { id: 'payouts', label: 'Payouts' },
] as const;

export function AccountTabs({ activeTab }: { activeTab: string }) {
  return (
    <nav aria-label="Account sections" className="mb-8 border-b">
      <ul className="-mb-px flex gap-6">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <li key={tab.id}>
              <Link
                href={tab.id === 'profile' ? '/profile' : `/profile?tab=${tab.id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center border-b-2 pb-3 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
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
