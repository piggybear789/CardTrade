'use client';

// Thumb-reach workspace chrome for marketplace routes below `lg`. Five hubs replace
// the wrapping chip rail; Contracts opens a short sheet so the contract sections stay
// one tap away without eating the first screenful of content. Sell is the form itself.
//
// GUESTS GET THE BAR TOO, with their own hubs (`GUEST_MOBILE_HUBS`): Browse, Search,
// Sell, Sign in. A gated hub (Sell) becomes a link into sign-in carrying that hub's own
// target, so the tap still means what it looked like it meant. Nothing here decides
// access — `proxy.ts` still guards every protected path.
//
// UNREAD IS ON THE BAR. Inbox carries unread messages and Account unread
// notifications, the same red count the desktop bell shows; without them a phone
// gave no sign that anything was waiting.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { HandshakeIcon } from '@hugeicons/core-free-icons';

import { useStartDeal } from '@/components/deals/StartDealProvider';
import {
  GUEST_MOBILE_HUBS,
  MOBILE_HUBS,
  isMarketplaceSectionActive,
  mobileHubDestination,
  type MobileHub,
  type MobileHubId,
} from '@/components/layout/marketplace-nav-config';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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

function HubSheetLinks({
  hub,
  pathname,
  onNavigate,
}: {
  hub: Extract<MobileHub, { kind: 'sheet' }>;
  pathname: string;
  onNavigate: () => void;
}) {
  const { openDeal } = useStartDeal();

  return (
    <ul className="flex flex-col gap-tight pb-snug">
      {hub.id === 'contracts' ? (
        <li>
          <button
            type="button"
            onClick={() => {
              onNavigate();
              openDeal();
            }}
            className="flex min-h-11 w-full touch-manipulation items-center gap-cozy rounded-lg border border-transparent px-cozy py-2.5 text-left text-body font-medium text-foreground/85 transition-colors hover:bg-muted/70 focus:outline-none focus-visible:border-iris"
          >
            <HugeiconsIcon icon={HandshakeIcon}
              className="size-5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            Private Deal
          </button>
        </li>
      ) : null}
      {hub.links.map((link) => {
        const active = isMarketplaceSectionActive(pathname, link.href);
        const Icon = link.icon;
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 touch-manipulation items-center gap-cozy rounded-lg px-cozy py-2.5 text-body transition-colors border border-transparent focus:outline-none focus-visible:border-iris',
                active
                  ? 'bg-accent font-semibold text-accent-foreground'
                  : 'font-medium text-foreground/85 hover:bg-muted/70',
              )}
            >
              <HugeiconsIcon icon={Icon}
                className={cn(
                  'size-5 shrink-0',
                  active ? 'text-iris-ink' : 'text-muted-foreground',
                )}
                aria-hidden="true"
              />
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export interface MobileBottomNavProps {
  /** Resolved by the workspace layout; decides where a gated hub points. */
  isAuthenticated: boolean;
}

export function MobileBottomNav({ isAuthenticated }: MobileBottomNavProps) {
  const pathname = usePathname();
  const [openHub, setOpenHub] = useState<MobileHubId | null>(null);
  const unread = useWorkspaceUnread();
  const hubs = isAuthenticated ? MOBILE_HUBS : GUEST_MOBILE_HUBS;
  const unreadFor = (id: MobileHubId) =>
    id === 'messages' ? unread.messages : id === 'account' ? unread.notifications : 0;
  const isAuthPage = pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up');
  // NOT WHILE WRITING A LISTING. The form has its own header with the submit, and a
  // tab bar under a long form is five ways to leave it mid-sentence, one tap from the
  // field being typed in.
  const onListingForm = pathname === '/listings/new' || /^\/listings\/[^/]+\/edit$/.test(pathname);

  useEffect(() => {
    setOpenHub(null);
  }, [pathname]);

  if (onListingForm) return null;

  return (
    <>
      <nav
        aria-label="Marketplace hubs"
        data-hide-for-keyboard
        style={{ viewTransitionName: 'persistent-mobile-nav' }}
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-[0_-8px_28px_hsl(var(--foreground)/0.06)] md:hidden',
          openHub && 'z-[60]',
        )}
      >
        <ul className={cn('mx-auto grid h-14 max-w-lg', hubs.length === 5 ? 'grid-cols-5' : 'grid-cols-4')}>
          {hubs.map((hub) => {
            const active = hub.isActive(pathname);
            const Icon = hub.icon;
            const className = cn(
              'flex h-full min-h-14 w-full touch-manipulation flex-col items-center justify-center gap-0.5 px-tight text-meta transition-colors active:opacity-70 border border-transparent focus:outline-none focus-visible:border-iris',
              active
                ? 'font-semibold text-foreground'
                : 'font-medium text-muted-foreground',
            );

            // A guest tapping a gated hub goes straight to sign-in aimed at that hub.
            // Opening the sheet instead would show a menu whose every entry bounces.
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

            if (hub.kind === 'link') {
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
            }

            return (
              <li key={hub.id} className="min-w-0">
                <button
                  type="button"
                  aria-expanded={openHub === hub.id}
                  onClick={() =>
                    setOpenHub((current) =>
                      current === hub.id ? null : hub.id,
                    )
                  }
                  className={className}
                >
                  <HugeiconsIcon icon={Icon}
                    className={cn(
                      'size-5',
                      active ? 'text-iris-ink' : 'text-muted-foreground',
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{hub.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Guests never reach a sheet — their gated hubs are sign-in links — so the
          sheets are not mounted for them. `HubSheetLinks` reads `StartDealProvider`,
          which is a signed-in concern. */}
      {hubs.filter(
        (hub): hub is Extract<MobileHub, { kind: 'sheet' }> =>
          isAuthenticated && hub.kind === 'sheet',
      ).map((hub) => (
        <Sheet
          key={hub.id}
          open={openHub === hub.id}
          onOpenChange={(open) => setOpenHub(open ? hub.id : null)}
        >
          <SheetContent
            id={`mobile-hub-${hub.id}`}
            side="bottom"
            overlayClassName="inset-x-0 top-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))]"
            className="bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] max-h-[min(28rem,75dvh)] gap-0 rounded-t-xl border-border bg-card p-0 pb-snug"
          >
            <SheetHeader className="border-b border-border px-5 py-cozy text-left">
              <SheetTitle>{hub.title}</SheetTitle>
              <SheetDescription>{hub.description}</SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto overscroll-contain px-cozy pt-snug">
              <HubSheetLinks
                hub={hub}
                pathname={pathname}
                onNavigate={() => setOpenHub(null)}
              />
            </div>
          </SheetContent>
        </Sheet>
      ))}
    </>
  );
}
