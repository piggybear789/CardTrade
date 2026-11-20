import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';

import { ReferenceOrbitPending } from '@/components/references/ReferenceOrbitPending';
import { Avatar } from '@/components/ui/avatar';
import { referenceHref } from '@/domain/references/address';
import type { ReferenceSuggestion } from '@/lib/references/search';
import { cn } from '@/lib/utils';

// components/references/ReferenceOrbit.tsx
//
// The `/references` landing's one memorable element (0155): the search drawn as the
// centre of a trust network, with real referenced traders seated on its orbits. It is
// the same picture a person's page draws (`TrustOrbitsCanvas`: dashed orbit rings, a node
// per person, the handle and its count under each), so the landing previews the page it
// leads to instead of decorating it.
//
// THE NEXT PEOPLE, NOT THE TOP ONES. The list under the search shows the first
// `MOST_REFERENCED_ROWS`; the page passes the ones after them, so nobody appears twice.
// Only people with a photo are passed: at this size an initials disc reads as a
// placeholder. With fewer than four there is no orbit at all, rather than a lopsided one.
//
// GEOMETRY. The layer is centred on the search and keeps a 2:1 shape, sized in the same
// `clamp()` of the viewport width as the hero. Seats are angles on the inner ring, turned
// into percentages of the layer, so a face lands on the drawn ring at every width. The
// rings are masked out across the middle of the layer, where the heading, search and list
// sit, so a dashed line never runs behind text; what shows is an arc either side.
//
// WIDE SCREENS ONLY (`xl`). Below 1280px the band beside the search is too narrow for a
// face and its label, and the page stands on its own without them.

/** The drawing's units. The layer is the same 2:1 shape at every width. */
const VIEW_W = 1200;
const VIEW_H = 600;

/** The ring the faces sit on. */
const SEAT_RING = { rx: 530, ry: 255 } as const;
/** A wider, fainter ring around it, as the trust network draws its outer orbit. */
const OUTER_RING = { rx: 588, ry: 292 } as const;

/**
 * Hides the rings across the middle of the layer, fading in from the edge of the
 * search column (about a quarter of the layer's width either side of centre).
 */
const RING_MASK =
  'linear-gradient(90deg, #000 0%, #000 13%, transparent 25%, transparent 75%, #000 87%, #000 100%)';

type SeatSize = 'lg' | 'md';

/** A seat: an angle on the seat ring (0° is due right, y grows downward) and a size. */
interface Seat {
  angle: number;
  size: SeatSize;
}

/**
 * Seats in rank order: the next most referenced person takes the first one. Six seats
 * make a bracket either side, the two largest faces level with the search. Four seats
 * pair diagonally, so a short list still balances.
 */
const LAYOUTS = {
  six: [
    { angle: 180, size: 'lg' },
    { angle: 0, size: 'lg' },
    { angle: 220, size: 'md' },
    { angle: 40, size: 'md' },
    { angle: 320, size: 'md' },
    { angle: 140, size: 'md' },
  ],
  four: [
    { angle: 205, size: 'lg' },
    { angle: 25, size: 'lg' },
    { angle: 335, size: 'md' },
    { angle: 155, size: 'md' },
  ],
} as const satisfies Record<string, readonly Seat[]>;

/** Face diameters, in the same width-driven `clamp()` as the rest of the hero. */
const FACE_SIZE: Record<SeatSize, string> = {
  lg: 'size-[clamp(4rem,5vw,5.75rem)]',
  md: 'size-[clamp(3rem,3.75vw,4.25rem)]',
};

/**
 * A page-coloured halo around the label text, so a ring passing behind a name stops at
 * the letters, the way the trust network halos its labels (`stroke={CARD}`). Not a
 * backing box: on the glow a box showed as a pale rectangle, and cutting the rings
 * around each person instead left them in short fragments.
 */
const LABEL_HALO =
  '[text-shadow:0_0_2px_hsl(var(--background)),0_0_3px_hsl(var(--background)),0_0_4px_hsl(var(--background)),0_0_6px_hsl(var(--background))]';

/** Where a seat's centre falls, as percentages of the layer. */
function seatPosition(angle: number): { left: string; top: string } {
  const radians = (angle * Math.PI) / 180;
  const x = VIEW_W / 2 + SEAT_RING.rx * Math.cos(radians);
  const y = VIEW_H / 2 + SEAT_RING.ry * Math.sin(radians);
  return { left: `${((x / VIEW_W) * 100).toFixed(3)}%`, top: `${((y / VIEW_H) * 100).toFixed(3)}%` };
}

/**
 * One full turn of a ring as a path, starting at its left end and going clockwise on
 * screen (anticlockwise with `reverse`). `animateMotion` needs a path; an `<ellipse>`
 * cannot be referenced as one.
 */
function ringPath(ring: { rx: number; ry: number }, reverse: boolean): string {
  const left = VIEW_W / 2 - ring.rx;
  const cy = VIEW_H / 2;
  const sweep = reverse ? 0 : 1;
  return `M ${left} ${cy} a ${ring.rx} ${ring.ry} 0 1 ${sweep} ${ring.rx * 2} 0 a ${ring.rx} ${ring.ry} 0 1 ${sweep} ${-ring.rx * 2} 0`;
}

function TravellingDot({
  ring,
  seconds,
  fill,
  reverse = false,
}: {
  ring: { rx: number; ry: number };
  seconds: number;
  fill: string;
  reverse?: boolean;
}) {
  const path = ringPath(ring, reverse);
  return (
    <g>
      <circle r={9} fill={fill} opacity={0.14}>
        <animateMotion dur={`${seconds}s`} repeatCount="indefinite" path={path} />
      </circle>
      <circle r={3.5} fill={fill}>
        <animateMotion dur={`${seconds}s`} repeatCount="indefinite" path={path} />
      </circle>
    </g>
  );
}

export function ReferenceOrbit({ people }: { people: readonly ReferenceSuggestion[] }) {
  const seats: readonly Seat[] | null =
    people.length >= LAYOUTS.six.length
      ? LAYOUTS.six
      : people.length >= LAYOUTS.four.length
        ? LAYOUTS.four
        : null;
  if (!seats) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 hidden aspect-[2/1] w-[clamp(70rem,84vw,110rem)] -translate-x-1/2 -translate-y-1/2 xl:block">
      <svg
        aria-hidden
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="absolute inset-0 size-full overflow-visible"
        style={{ maskImage: RING_MASK, WebkitMaskImage: RING_MASK }}
      >
        {/* The trust network's own ring styles: a darker inner orbit, a border-grey outer. */}
        <ellipse
          cx={VIEW_W / 2}
          cy={VIEW_H / 2}
          rx={SEAT_RING.rx}
          ry={SEAT_RING.ry}
          fill="none"
          stroke="hsl(var(--foreground) / 0.16)"
          strokeWidth={1.2}
          strokeDasharray="3 5"
          vectorEffect="non-scaling-stroke"
        />
        <ellipse
          cx={VIEW_W / 2}
          cy={VIEW_H / 2}
          rx={OUTER_RING.rx}
          ry={OUTER_RING.ry}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={1}
          strokeDasharray="3 5"
          vectorEffect="non-scaling-stroke"
        />

        {/* A DOT TRAVELLING EACH RING, the one moving thing on RevenueCat's hero ring:
            slow, opposite ways, so the picture reads as live without anything asking
            to be looked at. The ring mask fades them out behind the search and back in
            on the far side. SMIL ignores the reduced-motion CSS, so the group is hidden
            outright under that preference rather than left frozen on the ring. */}
        <g className="motion-reduce:hidden">
          <TravellingDot ring={SEAT_RING} seconds={46} fill="hsl(var(--trust))" />
          <TravellingDot ring={OUTER_RING} seconds={70} fill="hsl(var(--iris))" reverse />
        </g>
      </svg>

      <ul aria-label="More referenced traders" className="absolute inset-0">
        {people.slice(0, seats.length).map((person, index) => {
          const seat = seats[index];
          return (
            <li
              key={`${person.kind}-${person.id}`}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={seatPosition(seat.angle)}
            >
              {/* The entrance is on its own element: `animate-in` animates `transform`,
                  which would otherwise undo the centring translate on the `li`. */}
              <div
                className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-90 motion-safe:fill-mode-both motion-safe:duration-700 motion-safe:ease-enter"
                style={{ animationDelay: `${150 + index * 70}ms` }}
              >
                <Link
                  href={referenceHref(person.address)}
                  prefetch={false}
                  className="group pointer-events-auto relative flex flex-col items-center rounded-full outline-none"
                >
                  <span
                    className={cn(
                      'relative block rounded-full shadow-md ring-[3px] ring-background transition-[transform,box-shadow] duration-move ease-enter',
                      'group-hover:-translate-y-0.5 group-hover:shadow-lg group-focus-visible:ring-ring motion-reduce:transition-none',
                      FACE_SIZE[seat.size],
                    )}
                  >
                    <Avatar
                      avatarPath={person.avatarPath}
                      displayName={person.name}
                      size="xl"
                      className="size-full"
                    />
                    <ReferenceOrbitPending />
                  </span>

                  {/* Hangs below the face so the face's centre stays on the ring. */}
                  <span
                    className={cn(
                      'absolute left-1/2 top-full mt-2 flex -translate-x-1/2 flex-col items-center whitespace-nowrap text-center',
                      LABEL_HALO,
                    )}
                  >
                    <span className="max-w-36 truncate text-meta font-semibold leading-snug text-foreground decoration-foreground/30 underline-offset-2 group-hover:underline">
                      {person.handle}
                    </span>
                    {/* A count: the tick says what is counted, one colour for the line
                        (see the suggestion rows in `ReferenceSearch`). */}
                    <span className="inline-flex items-center gap-0.5 text-meta font-medium leading-snug tabular-nums text-trust">
                      <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3 shrink-0" aria-hidden />
                      {person.referenceCount} positive
                    </span>
                  </span>
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
