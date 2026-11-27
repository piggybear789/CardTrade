'use client';

// Signed-in header tools. Loaded with the session, not with the catalog: a
// guest document that imported this file also imported the notification
// popover and the account menu.
//
// Sell, then Messages and the bell, then the avatar. The look and the reasons for it
// are in `HeaderControls`.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { ChatCircleIcon } from '@/components/ui/icons';

import {
  HEADER_ICON_BADGE,
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
import { CountBadge } from '@/components/ui/count-badge';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUnreadCounts } from '@/lib/realtime/useUnreadCounts';

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
  const pathname = usePathname();
  // ITS OWN COUNT. The header sits in the root layout, outside the
  // `WorkspaceChromeProvider` the rail and the phone bar read, so it takes the same
  // head counts itself. The hook starts from the last figures this tab read, so the
  // badge does not blink out when the route group changes.
  const unread = useUnreadCounts(userId);
  const onMessages = pathname === '/messages' || pathname.startsWith('/messages/');

  return (
    // ONE provider for the rail, so moving from one icon to the next shows the next
    // label at once instead of restarting the delay (see `HeaderTooltip`). Mounted
    // here rather than in the root layout so the tooltip code ships in this
    // signed-in chunk, not in the guest catalog document.
    <TooltipProvider delayDuration={300}>
      <HeaderSellLink />
      <HeaderTooltip label="Messages">
        <Link
          href="/messages"
          aria-label={unread.messages > 0 ? `Messages, ${unread.messages} unread` : 'Messages'}
          aria-current={onMessages ? 'page' : undefined}
          className={HEADER_ICON_BUTTON}
        >
          <Icon
            icon={ChatCircleIcon}
            weight={onMessages ? 'fill' : undefined}
            className={HEADER_ICON_GLYPH}
            aria-hidden
          />
          <CountBadge count={unread.messages} className={HEADER_ICON_BADGE} />
        </Link>
      </HeaderTooltip>
      <NotificationBell initialNotifications={initialNotifications} />
      {/* NO FEEDBACK CONTROL HERE. A filled "Feedback" button in the primary chrome
          competed with the page's own primary action and read as a beta label on
          every screen. The account menu carries it. */}
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
