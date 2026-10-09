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
 */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-[calc(100dvh-var(--chrome-top))] items-center justify-center overflow-x-clip px-group py-section sm:px-6">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
