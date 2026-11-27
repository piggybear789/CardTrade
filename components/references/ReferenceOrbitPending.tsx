'use client';

// components/references/ReferenceOrbitPending.tsx
//
// The spinner over a face on the `/references` landing while that person's page opens.
// A graph page is dynamic and has no loading boundary, so a click on a face would
// otherwise show nothing for a moment; the list under the search shows a spinner for the
// same reason. Always rendered and only faded in, so it never moves the face, and it
// waits 100ms so a fast navigation does not flash it.

import { useLinkStatus } from 'next/link';
import { Icon } from '@/components/ui/icon';
import { SpinnerGapIcon } from '@/components/ui/icons';

import { cn } from '@/lib/utils';

export function ReferenceOrbitPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-background/70 opacity-0 transition-opacity duration-enter',
        pending && 'opacity-100 delay-100',
      )}
    >
      <Icon
        icon={SpinnerGapIcon}
        className={cn('size-5 text-foreground', pending && 'animate-spin motion-reduce:animate-none')}
      />
    </span>
  );
}
