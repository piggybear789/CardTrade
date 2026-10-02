'use client';

// Guest account links stay in this module. The signed-in tools are a separate
// chunk, same arrangement as the non-catalog phone chrome: the marketplace
// document does not download the bell, the feedback dialog, or the account
// menu before the first grid.
//
// THE CHUNK HAS A PLACEHOLDER, NOT A HOLE. `next/dynamic` with no `loading`
// renders null until the chunk arrives. On a hard load that never shows — the
// server rendered the tools and hydration waits for the chunk — but on a CLIENT
// render it does: signing in from the form swaps the guest links for this chunk,
// and the rail used to blink empty and then pop in, moving the search on `xl`
// where the side columns are content-width. The placeholder occupies the same
// boxes the tools do, and the root layout's header skeleton draws it too, so the
// two loading states of this slot are one shape.

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';

import { GuestHeaderCtas } from '@/components/layout/GuestHeaderCtas';
import { Skeleton } from '@/components/ui/skeleton';

const SignedInTools = dynamic(
  () =>
    import('@/components/layout/SignedInHeaderTools').then((mod) => mod.SignedInHeaderTools),
  { loading: () => <SignedInHeaderToolsPlaceholder /> },
);

type ToolsProps = ComponentProps<typeof SignedInTools>;

export function HeaderAccountSlot(
  props: { isAuthenticated: boolean } & ToolsProps,
) {
  if (!props.isAuthenticated) return <GuestHeaderCtas />;
  return <SignedInTools {...props} />;
}

/**
 * The signed-in rail's footprint, box for box, for while it is not yet there.
 *
 * Mirrors `SignedInHeaderTools`: Saved, Messages and the bell are `size-10`
 * targets; Feedback is an `h-8` outlined label from `xl` only; the profile chip is
 * an `h-10` ghost button holding a 24px avatar and the name; the burger is
 * `size-11`. A Fragment, so each box is a flex item of the header column and
 * takes that column's own `gap` exactly as the real controls do.
 *
 * The bars are `bg-white/10` because they sit on the obsidian bar, not on paper —
 * the same override `SiteHeaderSkeleton` uses.
 */
export function SignedInHeaderToolsPlaceholder() {
  return (
    <>
      {['saved', 'messages', 'bell'].map((slot) => (
        <span
          key={slot}
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center"
        >
          <Skeleton className="size-5 rounded-full bg-white/10" />
        </span>
      ))}
      <Skeleton className="hidden h-8 w-[5.5rem] shrink-0 bg-white/10 xl:block" />
      <span
        aria-hidden="true"
        className="hidden h-10 min-w-0 shrink-0 items-center gap-snug px-snug md:inline-flex"
      >
        <Skeleton className="size-6 shrink-0 rounded-full bg-white/10" />
        <Skeleton className="h-3.5 w-20 bg-white/10" />
      </span>
      <span
        aria-hidden="true"
        className="hidden size-11 shrink-0 items-center justify-center md:inline-flex"
      >
        <Skeleton className="size-5 bg-white/10" />
      </span>
    </>
  );
}
