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
      <ul className="-mb-px flex gap-section">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <li key={tab.id}>
              <Link
                href={tab.id === 'profile' ? '/profile' : `/profile?tab=${tab.id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex items-center px-tight pb-cozy text-body font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
                {/* Indicator as an absolutely-positioned bar rather than a
                    `border-b`, so it can be thicker than the nav's own hairline and
                    carry a rounded cap without shifting the label. */}
                {active ? (
                  <span
                    className="absolute inset-x-0 -bottom-px h-0.5 rounded-t-full bg-gold"
                    aria-hidden
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
