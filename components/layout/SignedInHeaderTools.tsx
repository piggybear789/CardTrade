'use client';

// Signed-in header tools. Loaded with the session, not with the catalog: a
// guest document that imported this file also imported the notification
// popover and the account menu.
//
// Sell, then Saved, Messages and the bell, then the avatar. The look and the reasons
// for it are in `HeaderControls`.

import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { ChatCircleIcon, HeartIcon } from '@/components/ui/icons';

import {
  HEADER_ICON_BUTTON,
  HEADER_ICON_GLYPH,
  HeaderSellLink,
} from '@/components/layout/HeaderControls';
import { HeaderTooltip } from '@/components/layout/HeaderTooltip';
import { SiteMenu } from '@/components/layout/SiteMenu';
import {
  NotificationBell,
  type NotificationBellProps,
} from '@/components/notifications/NotificationBell';
import { TooltipProvider } from '@/components/ui/tooltip';

export function SignedInHeaderTools({
  email,
  userId,
  isAdmin,
  isStaff,
  displayName,
  avatarPath,
  initialNotifications,
}: {
  email: string | null;
  userId: string | null;
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
      <HeaderSellLink />
      {/* A HEART, because saving IS the heart: `WatchButton` draws one on every
          listing, and the /saved empty state tells members to tap it. */}
      <HeaderTooltip label="Saved">
        <Link href="/saved" aria-label="Saved listings" className={HEADER_ICON_BUTTON}>
          <Icon
            icon={HeartIcon}
            className={HEADER_ICON_GLYPH}
            aria-hidden
          />
        </Link>
      </HeaderTooltip>
      <HeaderTooltip label="Messages">
        <Link href="/messages" aria-label="Messages" className={HEADER_ICON_BUTTON}>
          <Icon
            icon={ChatCircleIcon}
            className={HEADER_ICON_GLYPH}
            aria-hidden
          />
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
        userId={userId}
      />
    </TooltipProvider>
  );
}
