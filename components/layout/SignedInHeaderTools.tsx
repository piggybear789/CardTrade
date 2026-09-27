'use client';

// Signed-in header tools. Loaded with the session, not with the catalog: a
// guest document that imported this file also imported the feedback dialog,
// the notification popover, and the account menu.

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { HeartIcon, MessageCircleIcon } from '@hugeicons/core-free-icons';

import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';
import { HeaderTooltip } from '@/components/layout/HeaderTooltip';
import { SiteMenu } from '@/components/layout/SiteMenu';
import {
  NotificationBell,
  type NotificationBellProps,
} from '@/components/notifications/NotificationBell';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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
      {/* WORDS, NOT AN ICON. This was a speech bubble beside the Messages bubble,
          so two neighbouring icons both said "conversation" and only one of them
          opened one. No glyph says "tell the team" on its own.

          From `xl` only. The label is ~53px wider than the icon was, and below
          `xl` the header has no room for it: measured, it narrowed the other
          icons to 22px and hid the member's name. Under `xl` the menu's Support
          section is the way in, and the Account tab has a row too.

          The rail runs from "things waiting for you" to "you". Feedback talks
          to us rather than about the marketplace, so it sits after the bell
          and before the account. */}
      <FeedbackDialog appearance="header-text" className="hidden xl:inline-flex" />
      {/* `!h-10` matches the 40px icon targets beside it. The `sm` size
          collapses to 24px from `md`, the same height as the avatar, and the
          button's clip cropped the circle into an ellipse.

          `xl:max-w-[10rem]` until `2xl`: from `xl` the header keeps this rail at
          full width and takes the room from the search (see `SiteHeader`), and a
          display name may run to 255 characters. At 14rem a long one left a
          ~110px search box at 1280px; at 10rem it leaves ~170px. */}
      <Button asChild variant="ghost" size="sm" className="hidden !h-10 min-w-0 max-w-[9rem] px-snug md:inline-flex md:max-w-[14rem] xl:max-w-[10rem] 2xl:max-w-[14rem]">
        <Link
          href="/profile"
          className="flex min-w-0 items-center gap-snug"
          aria-label={displayName ?? 'Your profile'}
          title={displayName ?? 'Your profile'}
        >
          <Avatar
            avatarPath={avatarPath}
            displayName={displayName}
            size="xs"
            className="border-white/25"
          />
          <span className="hidden min-w-0 truncate md:inline">{displayName ?? 'Profile'}</span>
        </Link>
      </Button>
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
