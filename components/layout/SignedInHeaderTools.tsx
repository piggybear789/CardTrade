'use client';

// Signed-in header tools. Loaded with the session, not with the catalog: a
// guest document that imported this file also imported the feedback dialog,
// the notification popover, and the account menu.

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { BookmarkCheck01Icon, MessageCircleIcon } from '@hugeicons/core-free-icons';

import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';
import { SiteMenu } from '@/components/layout/SiteMenu';
import {
  NotificationBell,
  type NotificationBellProps,
} from '@/components/notifications/NotificationBell';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

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
    <>
      <Link
        href="/saved"
        aria-label="Saved listings"
        title="Saved"
        className="inline-flex size-10 touch-manipulation items-center justify-center rounded-md border border-transparent text-mist/75 transition-colors hover:bg-white/10 hover:text-mist focus:outline-none focus-visible:border-iris md:inline-flex"
      >
        <HugeiconsIcon icon={BookmarkCheck01Icon} className="size-5" aria-hidden />
      </Link>
      <Link
        href="/messages"
        aria-label="Messages"
        title="Messages"
        className="hidden size-10 touch-manipulation items-center justify-center rounded-md border border-transparent text-mist/75 transition-colors hover:bg-white/10 hover:text-mist focus:outline-none focus-visible:border-iris md:inline-flex"
      >
        <HugeiconsIcon icon={MessageCircleIcon} className="size-5" aria-hidden />
      </Link>
      <NotificationBell initialNotifications={initialNotifications} />
      {/* The rail runs from "things waiting for you" to "you". Feedback talks
          to us rather than about the marketplace, so it sits after the bell
          and before the account. */}
      <FeedbackDialog appearance="header-icon" />
      {/* `!h-10` matches the 40px icon targets beside it. The `sm` size
          collapses to 24px from `md`, the same height as the avatar, and the
          button's clip cropped the circle into an ellipse. */}
      <Button asChild variant="ghost" size="sm" className="hidden !h-10 min-w-0 max-w-[9rem] px-snug md:inline-flex md:max-w-[14rem]">
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
    </>
  );
}
