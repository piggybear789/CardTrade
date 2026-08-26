'use client';

// components/account/AccountTabs.tsx
//
// TWO PRESENTATIONS OF ONE NAV. On phones this is a segmented control; from `md` it
// is the underlined tab strip it has always been.
//
// WHY THEY DIFFER. A signed-in phone already carries a bottom tab bar with "Account"
// in it, so a second underlined tab row directly beneath the page title read as two
// competing navigations stacked on top of each other — and underline tabs are a
// pointer-era affordance anyway: the target is the word, and the rule under it is the
// only thing saying they are a set. A segmented control makes the set explicit,
// gives each option a full-height touch target instead of a text-sized one, and is
// what a member coming from any other phone app already knows.
//
// Desktop keeps the underline: there is no bottom bar to compete with, the pointer
// makes small targets fine, and the strip lines up with the tabbed surfaces
// elsewhere in the app.

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
    <nav
      aria-label="Account sections"
      className="mb-group md:mb-section md:border-b"
    >
      <ul
        className={cn(
          // Phone: one segmented track, thirds, no scroll — three short labels fit
          // at 320px, so the horizontal overflow this used to need is gone.
          'grid grid-cols-3 gap-tight rounded-lg bg-muted p-1',
          // Desktop: back to an inline underlined strip.
          'md:-mb-px md:flex md:gap-section md:rounded-none md:bg-transparent md:p-0',
        )}
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <li key={tab.id} className="min-w-0">
              <Link
                href={tab.id === 'profile' ? '/profile' : `/profile?tab=${tab.id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-9 items-center justify-center truncate rounded-md px-tight',
                  'text-body font-medium transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/60',
                  // Phone: the active segment is a raised chip on the track.
                  active
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground active:bg-card/60',
                  // Desktop: drop the chip entirely and go back to type + underline.
                  'md:min-h-0 md:justify-start md:rounded-none md:px-tight md:pb-cozy md:shadow-none',
                  active
                    ? 'md:bg-transparent'
                    : 'md:hover:text-foreground md:active:bg-transparent',
                )}
              >
                {tab.label}
                {/* Underline only exists in the desktop presentation; on the phone
                    the chip already carries selection. */}
                {active ? <TabIndicator layoutId="account-tabs" className="hidden md:block" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
