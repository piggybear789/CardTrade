'use client';

// Thumb-reach workspace chrome for signed-in marketplace routes below `lg`.
// Five hubs replace the wrapping chip rail; Contracts and Sell open short
// sheets so the full section glossary stays one tap away without eating the
// first screenful of content.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  MOBILE_HUBS,
  isMarketplaceSectionActive,
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
  return (
    <ul className="flex flex-col gap-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
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
                'flex min-h-12 touch-manipulation items-center gap-3 rounded-lg px-3 py-3 text-body transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-gold/10 font-semibold text-foreground'
                  : 'font-medium text-foreground/85 hover:bg-muted/70',
              )}
            >
              <Icon
                className={cn(
                  'size-5 shrink-0',
                  active ? 'text-gold' : 'text-muted-foreground',
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

export function MobileBottomNav() {
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
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-[0_-8px_28px_hsl(var(--foreground)/0.06)] md:hidden"
      >
        <ul className="mx-auto grid h-14 max-w-lg grid-cols-5">
          {MOBILE_HUBS.map((hub) => {
            const active = hub.isActive(pathname);
            const Icon = hub.icon;
            const className = cn(
              'flex h-full min-h-14 w-full touch-manipulation flex-col items-center justify-center gap-0.5 px-1 text-meta transition-colors active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              active
                ? 'font-semibold text-foreground'
                : 'font-medium text-muted-foreground',
            );

            if (hub.kind === 'link') {
              return (
                <li key={hub.id} className="min-w-0">
                  <Link
                    href={hub.href}
                    aria-current={active ? 'page' : undefined}
                    className={className}
                  >
                    <Icon
                      className={cn(
                        'size-5',
                        active ? 'text-gold' : 'text-muted-foreground',
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
                  <Icon
                    className={cn(
                      'size-5',
                      active ? 'text-gold' : 'text-muted-foreground',
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

      {MOBILE_HUBS.filter(
        (hub): hub is Extract<MobileHub, { kind: 'sheet' }> =>
          hub.kind === 'sheet',
      ).map((hub) => (
        <Sheet
          key={hub.id}
          open={openHub === hub.id}
          onOpenChange={(open) => setOpenHub(open ? hub.id : null)}
        >
          <SheetContent
            id={`mobile-hub-${hub.id}`}
            side="bottom"
            className="max-h-[min(28rem,75dvh)] gap-0 rounded-t-xl border-border bg-card p-0"
          >
            <SheetHeader className="border-b border-border px-5 py-4 text-left">
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
