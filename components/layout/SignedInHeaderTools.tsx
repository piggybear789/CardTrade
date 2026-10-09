'use client';

// Signed-in header tools. Loaded with the session, not with the catalog: a
// guest document that imported this file also imported the notification
// popover and the account menu.

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { HeartIcon, MessageCircleIcon } from '@hugeicons/core-free-icons';

import { HeaderTooltip } from '@/components/layout/HeaderTooltip';
import { SiteMenu } from '@/components/layout/SiteMenu';
import {
  NotificationBell,
  type NotificationBellProps,
} from '@/components/notifications/NotificationBell';
import { TooltipProvider } from '@/components/ui/tooltip';

export function SignedInHeaderTools({
  email,
  isAdmin,
  isStaff,
  displayName,
  avatarPath,
  initialNotifications,
}: {
  email: string | null;
  isAdmin: boolean;
  isStaff: boolean;
  displayName: string | null;
  avatarPath: string | null;
  initialNotifications: NotificationBellProps['initialNotifications'];
}) {
  return (
    // ONE provider for the rail, so moving from one icon to the next shows the next
    // label at once instead of restarting the delay (see `HeaderTooltip`). Mounted
    // here rather than in the root layout so the tooltip code ships in this
    // signed-in chunk, not in the guest catalog document.
    <TooltipProvider delayDuration={300}>
      {/* A HEART, because saving IS the heart: `WatchButton` draws one on every
          listing, and the /saved empty state tells members to tap it. This was a
          bookmark, so the control you pressed and the place it filed things
          under did not look alike. */}
      <HeaderTooltip label="Saved">
        <Link
          href="/saved"
          aria-label="Saved listings"
          className="inline-flex size-10 touch-manipulation items-center justify-center rounded-md border border-transparent text-mist/75 transition-colors hover:bg-white/10 hover:text-mist focus:outline-none focus-visible:border-iris md:inline-flex"
        >
          <HugeiconsIcon icon={HeartIcon} className="size-5" aria-hidden />
        </Link>
      </HeaderTooltip>
      <HeaderTooltip label="Messages">
        <Link
          href="/messages"
          aria-label="Messages"
          className="hidden size-10 touch-manipulation items-center justify-center rounded-md border border-transparent text-mist/75 transition-colors hover:bg-white/10 hover:text-mist focus:outline-none focus-visible:border-iris md:inline-flex"
        >
          <HugeiconsIcon icon={MessageCircleIcon} className="size-5" aria-hidden />
        </Link>
      </HeaderTooltip>
      <NotificationBell initialNotifications={initialNotifications} />
      {/* NO FEEDBACK CONTROL IN THE RAIL. A filled "Feedback" button in the
          primary chrome competed with the page's own primary action and read as
          a beta label on every screen. The account menu's Support section and the
          Account tab both carry it. */}
      {/* The avatar chip. It opens the menu, whose first row is Account. */}
      <SiteMenu
        isAuthenticated
        isAdmin={isAdmin}
        isStaff={isStaff}
        displayName={displayName}
        avatarPath={avatarPath}
        email={email}
      />
    </TooltipProvider>
  );
}
