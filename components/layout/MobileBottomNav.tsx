'use client';

// Thumb-reach chrome below `md`. Five hubs, every one a single tap: Browse, References,
// Sell, Inbox, Account. References took the second slot from Contracts, whose rows
// (Purchases, Sales, Trades, Private Deal) are on the Account screen now, beside the
// rest of a member's activity. Sell is the form itself.
//
// ALWAYS ON SCREEN. Both the `(workspace)` and `(marketing)` layouts mount this bar, so
// it stays under the catalog, References, the help and policy pages and the listing
// form, and no page opts out. A tab bar that vanished when one of its own tabs was
// tapped (Sell, References) read as the app losing its place. A new listing keeps its
// typed text across an in-app navigation (`useItemFormDraft`), and an edit is no worse
// off than with its own back chevron. The bar steps aside only while the software
// keyboard is open (`data-hide-for-keyboard`), when the keyboard is the bottom chrome.
// Routes outside those two groups (sign-in, onboarding, the deal composer) are focused
// flows and do not mount it.
//
// GUESTS GET THE BAR TOO, with their own hubs (`GUEST_MOBILE_HUBS`): Browse, References,
// Search, Sell, Sign in. A gated hub (Sell) becomes a link into sign-in carrying that
// hub's own target, so the tap still means what it looked like it meant. Nothing here
// decides access — `proxy.ts` still guards every protected path.
//
// UNREAD IS ON THE BAR. Inbox carries unread messages and Account unread
// notifications, the same red count the desktop bell shows; without them a phone
// gave no sign that anything was waiting.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';

import {
  GUEST_MOBILE_HUBS,
  MOBILE_HUBS,
  mobileHubDestination,
  type MobileHubId,
} from '@/components/layout/marketplace-nav-config';
import { CountBadge } from '@/components/ui/count-badge';
import { useWorkspaceUnread } from '@/components/layout/WorkspaceChrome';
import { cn } from '@/lib/utils';

/**
 * Focus the search field already on screen, if there is one. Returns whether it did.
 * `data-market-search` is the marker `HeaderSearch` puts on its input.
 */
function focusVisibleSearch(): boolean {
  const fields = document.querySelectorAll<HTMLInputElement>('input[data-market-search]');
  for (const field of fields) {
    if (field.disabled || field.getClientRects().length === 0) continue;
    field.focus();
    field.select();
    return true;
  }
  return false;
}

export interface MobileBottomNavProps {
  /** Resolved by the mounting layout; decides where a gated hub points. */
  isAuthenticated: boolean;
}

export function MobileBottomNav({ isAuthenticated }: MobileBottomNavProps) {
  const pathname = usePathname();
  const unread = useWorkspaceUnread();
  const hubs = isAuthenticated ? MOBILE_HUBS : GUEST_MOBILE_HUBS;
  const unreadFor = (id: MobileHubId) =>
    id === 'messages' ? unread.messages : id === 'account' ? unread.notifications : 0;
  const isAuthPage = pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up');

  return (
    <nav
      aria-label="Marketplace hubs"
      data-hide-for-keyboard
      style={{ viewTransitionName: 'persistent-mobile-nav' }}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-[0_-8px_28px_hsl(var(--foreground)/0.06)] md:hidden"
    >
      <ul className={cn('mx-auto grid h-14 max-w-lg', hubs.length === 5 ? 'grid-cols-5' : 'grid-cols-4')}>
        {hubs.map((hub) => {
          const active = hub.isActive(pathname);
          const Icon = hub.icon;
          // `px-0.5`, not `px-tight`: "References" is the longest label the bar has
          // carried. A fifth of a 360px phone is 72px, and 4px of padding a side left
          // the label about 62px, a pixel or two short, so it truncated on the
          // smallest phones.
          const className = cn(
            'flex h-full min-h-14 w-full touch-manipulation flex-col items-center justify-center gap-0.5 px-0.5 text-meta transition-colors active:opacity-70 border border-transparent focus:outline-none focus-visible:border-ring',
            active
              ? 'font-semibold text-foreground'
              : 'font-medium text-muted-foreground',
          );

          // A guest tapping a gated hub goes straight to sign-in aimed at that hub.
          if (!isAuthenticated && hub.requiresAuth) {
            const destination = mobileHubDestination(hub);
            return (
              <li key={hub.id} className="min-w-0">
                <Link
                  href={`/sign-in?redirectTo=${encodeURIComponent(destination)}`}
                  className={className}
                >
                  <HugeiconsIcon
                    icon={Icon}
                    className="size-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="truncate">{hub.label}</span>
                  <span className="sr-only">(sign in required)</span>
                </Link>
              </li>
            );
          }

          const count = unreadFor(hub.id);
          // Sign in returns to the page the guest was on, as every sign-in link does.
          const href =
            hub.id === 'sign-in' && !isAuthPage
              ? `/sign-in?redirectTo=${encodeURIComponent(pathname)}`
              : hub.href;
          return (
            <li key={hub.id} className="min-w-0">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                onClick={
                  hub.id === 'search'
                    ? (event) => {
                        if (focusVisibleSearch()) event.preventDefault();
                      }
                    : undefined
                }
                className={className}
              >
                <span className="relative">
                  <HugeiconsIcon icon={Icon}
                    className={cn(
                      'size-5',
                      active ? 'text-iris-ink' : 'text-muted-foreground',
                    )}
                    aria-hidden="true"
                  />
                  <CountBadge count={count} className="absolute -right-2.5 -top-1.5" />
                </span>
                <span className="truncate">{hub.label}</span>
                {count > 0 ? <span className="sr-only">, {count} unread</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
