'use client';

// components/layout/HeaderTooltip.tsx
//
// The visible name of an icon-only control in the dark desktop header rail.
//
// It replaced `title` attributes. The browser shows a title only after a long hover,
// never on keyboard focus, and in an unstyled box of its own, so hovering an icon to
// find out what it did told the member nothing for the better part of a second.
//
// Needs a `TooltipProvider` above it. `SignedInHeaderTools` mounts ONE for the whole
// rail rather than one per icon: once a label is showing, moving to the next icon
// shows its label at once instead of restarting the delay.

import type { ReactElement } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Labels `children` on hover and keyboard focus.
 *
 * `children` must be a single element that forwards its ref and props (a `Link`, a
 * `button`, a Radix trigger), because the trigger is attached with `asChild`.
 */
export function HeaderTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
