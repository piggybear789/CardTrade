'use client';

// components/deals/StartDealButton.tsx
//
// Surfaces that open the compose dialog. Signed-out visitors open it too: the
// composer asks for an account at Get link, after the deal is written, so there
// is no sign-up detour in front of it.
//
// The label is "Private Deal"; the symbols are still `StartDeal*`. That split is
// deliberate and not worth closing: `useStartDeal`, `DEAL_OPEN_PATH`, `?deal=1`
// and `dealInvites` are one graph, and renaming a route param and a server
// action to restyle a button is churn with no user on the other end. The word
// the product already used for this in prose — help, the trades empty state,
// this dialog's own description — was "private deal". Only the button disagreed.

import type { ReactNode } from 'react';
import { HandshakeIcon } from '@hugeicons/core-free-icons';

import { SettingsListRow } from '@/components/account/SettingsPrimitives';
import { useStartDeal } from '@/components/deals/StartDealProvider';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import { Button, type ButtonProps } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export function StartDealButton({
  variant = 'outline',
  size,
  className,
  children = 'Private Deal',
  onOpen,
}: {
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  children?: ReactNode;
  /** Called before the dialog opens — used to close the overflow menu. */
  onOpen?: () => void;
}) {
  const { openDeal } = useStartDeal();

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
  className,
  children = 'Private Deal',
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { openDeal } = useStartDeal();

  return (
    <button type="button" className={className} onClick={openDeal}>
      {children}
    </button>
  );
}

export function StartDealRailAction() {
  const { openDeal } = useStartDeal();
  return <RailPrimaryAction onClick={openDeal}>Private Deal</RailPrimaryAction>;
}

/**
 * The Private Deal row in the Account screen's phone-only contracts group.
 *
 * It was the first row of the bar's Contracts sheet, and moved with Purchases, Sales and
 * Trades when References took that slot. Built here, client-side, because the Account
 * page is a Server Component and cannot hand a row its `onClick` (see `interactive` on
 * `SettingsListRow`).
 */
export function StartDealSettingRow() {
  const { openDeal } = useStartDeal();
  return <SettingsListRow icon={HandshakeIcon} label="Private Deal" onClick={openDeal} />;
}

export function StartDealEmptyState({
  actionLabel = 'Private Deal',
  actionVariant,
  showAction = true,
  ...props
}: Omit<Parameters<typeof EmptyState>[0], 'action'> & {
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
        showAction
          ? { label: actionLabel, variant: actionVariant, onClick: openDeal }
          : undefined
      }
    />
  );
}
