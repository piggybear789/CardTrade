'use client';

// components/account/AccountTabs.tsx

import Link from 'next/link';
import { TabIndicator } from '@/components/motion/TabIndicator';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'verification', label: 'Verification' },
  { id: 'payouts', label: 'Payouts' },
] as const;

export function AccountTabs({ activeTab }: { activeTab: string }) {
  return (
    <nav aria-label="Account sections" className="mb-4 border-b md:mb-8">
      <ul className="-mb-px flex gap-3 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-section [&::-webkit-scrollbar]:hidden">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <li key={tab.id}>
              <Link
                href={tab.id === 'profile' ? '/profile' : `/profile?tab=${tab.id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex items-center px-tight pb-cozy text-body font-medium transition-colors',
                  'border border-transparent focus-visible:outline-none focus-visible:border-gold/40',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
                {active ? <TabIndicator layoutId="account-tabs" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
