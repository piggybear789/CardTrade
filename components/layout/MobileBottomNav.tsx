'use client';

// Thumb-reach workspace chrome for marketplace routes below `lg`. Five hubs replace
// the wrapping chip rail; Contracts and Sell open short sheets so the full section
// glossary stays one tap away without eating the first screenful of content.
//
// GUESTS GET THE BAR TOO. It used to be mounted only for a signed-in member, which
// meant the two routes a signed-out visitor can actually reach — the catalog and a
// listing page — were the only two screens in the app with no bottom navigation at
// all. Having arrived on a listing from a search result, they had nothing to tap.
//
// What changes for them is the DESTINATION, not the chrome: an auth-gated hub becomes
// a link into sign-in carrying that hub's own target, so the tap still means what it
// looked like it meant. Nothing here decides access — `proxy.ts` still guards every
// protected path, and this only spares the guest a bounce.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { HandshakeIcon } from '@hugeicons/core-free-icons';

import { useStartDeal } from '@/components/deals/StartDealProvider';
import {
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
import { cn } from '@/lib/utils';

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
    <ul className="flex flex-col gap-1 pb-2">
      {hub.id === 'contracts' ? (
        <li>
          <button
            type="button"
            onClick={() => {
              onNavigate();
              openDeal();
            }}
            className="flex min-h-11 w-full touch-manipulation items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left text-body font-medium text-foreground/85 transition-colors hover:bg-muted/70 focus:outline-none focus-visible:border-iris"
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
                'flex min-h-11 touch-manipulation items-center gap-3 rounded-lg px-3 py-2.5 text-body transition-colors border border-transparent focus:outline-none focus-visible:border-iris',
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

  useEffect(() => {
    setOpenHub(null);
  }, [pathname]);

  return (
    <>
      <nav
        aria-label="Marketplace hubs"
        style={{ viewTransitionName: 'persistent-mobile-nav' }}
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-[0_-8px_28px_hsl(var(--foreground)/0.06)] md:hidden',
          openHub && 'z-[60]',
        )}
      >
        <ul className="mx-auto grid h-14 max-w-lg grid-cols-5">
          {MOBILE_HUBS.map((hub) => {
            const active = hub.isActive(pathname);
            const Icon = hub.icon;
            const className = cn(
              'flex h-full min-h-14 w-full touch-manipulation flex-col items-center justify-center gap-0.5 px-1 text-meta transition-colors active:opacity-70 border border-transparent focus:outline-none focus-visible:border-iris',
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
              return (
                <li key={hub.id} className="min-w-0">
                  <Link
                    href={hub.href}
                    aria-current={active ? 'page' : undefined}
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
      {MOBILE_HUBS.filter(
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
            className="bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] max-h-[min(28rem,75dvh)] gap-0 rounded-t-xl border-border bg-card p-0 pb-2"
          >
            <SheetHeader className="border-b border-border px-5 py-3 text-left">
              <SheetTitle>{hub.title}</SheetTitle>
              <SheetDescription>{hub.description}</SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto overscroll-contain px-3 pt-2">
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
