'use client';

// Guest account links stay in this module. The signed-in tools are a separate
// chunk, same arrangement as the non-catalog phone chrome: the marketplace
// document does not download the bell, the feedback dialog, or the account
// menu before the first grid.

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';

import { GuestHeaderCtas } from '@/components/layout/GuestHeaderCtas';

const SignedInTools = dynamic(() =>
  import('@/components/layout/SignedInHeaderTools').then((mod) => mod.SignedInHeaderTools),
);

type ToolsProps = ComponentProps<typeof SignedInTools>;

export function HeaderAccountSlot(
  props: { isAuthenticated: boolean } & ToolsProps,
) {
  if (!props.isAuthenticated) return <GuestHeaderCtas />;
  return <SignedInTools {...props} />;
}
