'use client';

// components/deals/StartDealButton.tsx
//
// Surfaces that open the compose dialog. Guests go to sign-up and come back
// with `?deal=1`, which StartDealProvider turns into the dialog.

import type { ReactNode } from 'react';

import { DEAL_OPEN_PATH } from '@/components/deals/dealPaths';
import { useStartDeal } from '@/components/deals/StartDealProvider';
import { SignInLink } from '@/components/layout/SignInLink';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import { Button, type ButtonProps } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export function StartDealButton({
  isAuthenticated,
  variant = 'outline',
  size,
  className,
  children = 'Start a Deal',
  onOpen,
}: {
  isAuthenticated: boolean;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  children?: ReactNode;
  /** Called before the dialog opens — used to close the overflow menu. */
  onOpen?: () => void;
}) {
  const { openDeal } = useStartDeal();

  if (!isAuthenticated) {
    return (
      <Button asChild variant={variant} size={size} className={className}>
        <SignInLink target="/sign-up" redirectTo={DEAL_OPEN_PATH}>
          {children}
        </SignInLink>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => {
        onOpen?.();
        openDeal();
      }}
    >
      {children}
    </Button>
  );
}

export function StartDealTextLink({
  isAuthenticated,
  className,
  children = 'Start a Deal',
}: {
  isAuthenticated: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const { openDeal } = useStartDeal();

  if (!isAuthenticated) {
    return (
      <SignInLink target="/sign-up" redirectTo={DEAL_OPEN_PATH} className={className}>
        {children}
      </SignInLink>
    );
  }

  return (
    <button type="button" className={className} onClick={openDeal}>
      {children}
    </button>
  );
}

export function StartDealRailAction() {
  const { openDeal } = useStartDeal();
  return <RailPrimaryAction onClick={openDeal}>Start a Deal</RailPrimaryAction>;
}

export function StartDealEmptyState({
  isAuthenticated,
  actionLabel = 'Start a Deal',
  actionVariant,
  showAction = true,
  ...props
}: Omit<Parameters<typeof EmptyState>[0], 'action'> & {
  isAuthenticated: boolean;
  actionLabel?: string;
  actionVariant?: 'default' | 'outline';
  /** Set false when a sibling already offers the same action. */
  showAction?: boolean;
}) {
  const { openDeal } = useStartDeal();

  return (
    <EmptyState
      {...props}
      action={
        !showAction
          ? undefined
          : isAuthenticated
            ? {
                label: actionLabel,
                variant: actionVariant,
                onClick: openDeal,
              }
            : {
                label: actionLabel,
                variant: actionVariant,
                href: `/sign-up?redirectTo=${encodeURIComponent(DEAL_OPEN_PATH)}`,
              }
      }
    />
  );
}
