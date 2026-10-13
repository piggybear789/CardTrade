import type { ReactNode } from 'react';

/**
 * The frame every credentials screen sits in: one card, centred in the space under
 * the chrome, on the page itself.
 *
 * ON THE PAGE, NOT ON A STAGE. These screens used to paint an obsidian backdrop with a
 * gold grid left over from an earlier palette. Under the dark desktop header that read
 * as one dark slab; under the light phone chrome it read as a modal over a blacked-out
 * page. Signing in is a page of the product, so it wears the product's own surface.
 *
 * The height subtracts `--chrome-top` (see globals.css) so a short form centres in
 * the visible space without leaving a permanent sliver of document scroll.
 *
 * `aside` sits beside the card from `lg` and under it below — the trust panel on
 * sign-in and sign-up. The form keeps its width and its place either way.
 */
export function AuthScreen({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <main className="flex min-h-[calc(100dvh-var(--chrome-top))] items-center justify-center overflow-x-clip px-group py-section sm:px-6">
      {aside ? (
        // STRETCHED, not centred, from `lg`: the aside is a tinted panel now and has to
        // stand as tall as the form card beside it, so the two read as one composition
        // rather than a card and a caption floating on an empty page.
        <div className="flex w-full max-w-md flex-col gap-section lg:max-w-4xl lg:flex-row lg:items-stretch lg:justify-center lg:gap-group">
          <div className="w-full max-w-md shrink-0">{children}</div>
          <div className="w-full max-w-md lg:max-w-sm">{aside}</div>
        </div>
      ) : (
        <div className="w-full max-w-md">{children}</div>
      )}
    </main>
  );
}
