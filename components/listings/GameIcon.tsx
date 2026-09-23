// Catalog game icons, in two flavours.
//
// `GameIcon` prefers a real brand logo from `public/games/<slug>.svg`. Those
// files were downloaded from Wikimedia Commons, not drawn here — provenance
// and licences are in `public/games/SOURCES.md`. Only six games have a
// licensable vector; the rest fall through to the drawn marks below, which are
// original monochrome symbols rather than official logos.
//
// `GameMark` is always the drawn mark. It exists for the desktop pills, whose
// fill inverts to near-black when active: a full-colour logo cannot follow the
// foreground, but a `currentColor` mark can.

import type { ReactNode, SVGProps } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { LayoutGridIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

type IconProps = SVGProps<SVGSVGElement>;

function mark(props: IconProps) {
  return {
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': true as const,
    ...props,
    className: cn('size-3.5 shrink-0', props.className),
  };
}

function PokemonMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.35" />
      <path d="M1.75 8h4.6M9.65 8h4.6" stroke="currentColor" strokeWidth="1.35" />
      <circle cx="8" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

// THE DRAWN MARKS ARE THE FALLBACK. The product decision (recorded in
// `public/games/SOURCES.md`) is to ship each game's REAL symbol where a vector
// exists or can be traced from a reference; `GAME_LOGO_ASPECT` below lists the
// slugs that have one. The marks here stand in for the rest until a reference
// is supplied — original monochrome symbols that suggest the game (a straw hat,
// a pyramid with an eye, a V-fin), drawn on a 16-unit grid and checked at 16px
// and 40px. They also remain the desktop pills' rendering, which needs
// `currentColor` to invert when active.

/** A straw hat: dome, brim, and the band drawn heavy so it reads at 16px. */
function OnePieceMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <ellipse cx="8" cy="10.6" rx="6.3" ry="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M3.7 10.2c.2-3.4 1.9-5.8 4.3-5.8s4.1 2.4 4.3 5.8"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M4.4 8.2h7.2" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

/** A pyramid with an eye — the Egyptian motif, not the puzzle. */
function YuGiOhMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path
        d="M8 2.3 13.6 13.6H2.4L8 2.3Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M5.3 10.1c.9-1.2 1.8-1.8 2.7-1.8s1.8.6 2.7 1.8c-.9 1.1-1.8 1.7-2.7 1.7s-1.8-.6-2.7-1.7Z"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <circle cx="8" cy="10.1" r=".9" fill="currentColor" />
    </svg>
  );
}

/** Five colours of mana, as five points of a pentagon. */
function MagicMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path
        d="M8 3 12.8 6.5 11 12.2H5L3.2 6.5 8 3Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        opacity=".7"
      />
      <circle cx="8" cy="3" r="1.75" fill="currentColor" />
      <circle cx="12.8" cy="6.5" r="1.75" fill="currentColor" />
      <circle cx="11" cy="12.2" r="1.75" fill="currentColor" />
      <circle cx="5" cy="12.2" r="1.75" fill="currentColor" />
      <circle cx="3.2" cy="6.5" r="1.75" fill="currentColor" />
    </svg>
  );
}

/** A hexagon split by a rift. */
function RiftboundMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path
        d="M8 1.8 13.6 5v6L8 14.2 2.4 11V5L8 1.8Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M8.6 4.4 6.8 8.2h2.4L7.4 11.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A hexagonal inkwell with a spark of ink. */
function LorcanaMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path
        d="M8 1.8 13.4 4.9v6.2L8 14.2 2.6 11.1V4.9L8 1.8Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M8 5.2 9.1 7.1 11 8 9.1 8.9 8 10.8 6.9 8.9 5 8l1.9-.9L8 5.2Z" fill="currentColor" />
    </svg>
  );
}

/** A mobile-suit helmet with the V-fin. */
function GundamMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path
        d="M4.3 6.6h7.4v5.4c0 .8-3.7 2-3.7 2s-3.7-1.2-3.7-2V6.6Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M8 6.4 3.4 1.9M8 6.4l4.6-4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M6.2 9.3h3.6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** A heart with a drop of blood. */
function FleshAndBloodMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path
        d="M8 14.2 3.4 8.8a3.2 3.2 0 0 1 4.6-4.5a3.2 3.2 0 0 1 4.6 4.5L8 14.2Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M8 5.2v3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** A lightsaber: thin hilt, heavy blade, crossguard. */
function StarWarsMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path d="M9.6 6.4 3.2 12.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9.6 6.4 13.9 2.1" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M8.2 5 11 7.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** A digivice: rounded body, screen, two buttons. */
function DigimonMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <rect x="2.3" y="3.6" width="11.4" height="8.8" rx="2.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="6.4" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="10.9" cy="6.9" r=".8" fill="currentColor" />
      <circle cx="10.9" cy="9.1" r=".8" fill="currentColor" />
    </svg>
  );
}

/** The four-star ball. Dots, not stars: a 1.4px star is noise at 16px. */
function DragonBallMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="6.1" cy="6.1" r="1.15" fill="currentColor" />
      <circle cx="9.9" cy="6.1" r="1.15" fill="currentColor" />
      <circle cx="6.1" cy="9.9" r="1.15" fill="currentColor" />
      <circle cx="9.9" cy="9.9" r="1.15" fill="currentColor" />
    </svg>
  );
}

/** Weiss and Schwarz: a circle half white, half black. */
function WeissMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4Z" fill="currentColor" />
    </svg>
  );
}

/** A V in a ring. */
function VanguardMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4.6 4.8 8 11.6l3.4-6.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Two linked rings: a union. */
function UnionArenaMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <circle cx="5.8" cy="8" r="3.9" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10.2" cy="8" r="3.9" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
function SportsMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M3.1 5.2c1.8.9 4.9.9 6.8 0M6.1 2.6c.7 2.3.7 8.5 0 10.8M9.9 2.6c-.7 2.3-.7 8.5 0 10.8M3.1 10.8c1.8-.9 4.9-.9 6.8 0"
        stroke="currentColor"
        strokeWidth="1.15"
      />
    </svg>
  );
}

function OtherTcgMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <rect x="4.4" y="2.6" width="7.4" height="9.4" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <rect x="2.6" y="4" width="7.4" height="9.4" rx="1" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

const GAME_MARKS: Record<string, (props: IconProps) => ReactNode> = {
  pokemon: PokemonMark,
  'one-piece': OnePieceMark,
  'yu-gi-oh': YuGiOhMark,
  'magic-the-gathering': MagicMark,
  riftbound: RiftboundMark,
  'disney-lorcana': LorcanaMark,
  gundam: GundamMark,
  'flesh-and-blood': FleshAndBloodMark,
  'star-wars-unlimited': StarWarsMark,
  digimon: DigimonMark,
  'dragon-ball-super': DragonBallMark,
  'weiss-schwarz': WeissMark,
  'cardfight-vanguard': VanguardMark,
  'union-arena': UnionArenaMark,
  'sports-cards': SportsMark,
  'other-tcg': OtherTcgMark,
};

// A HUE PER GAME, for the drawn marks. With the Poké Ball as the only coloured
// glyph in the category grid, fifteen monochrome neighbours read as icons that
// had failed to load. Each colour is the one a collector associates with the game
// — straw-hat gold, Digimon orange, saber green — chosen to be distinct from its
// grid neighbours and at ≥3:1 against the tile so the glyph still has an edge.
// None is a trademarked colour specification; they are the family, not the swatch.
//
// Applied by `GameIcon` only. `GameMark` (the desktop pills) stays `currentColor`
// because those pills invert to near-black when active and a fixed hue cannot
// follow that. `other-tcg` and `all` are categories, not games, and stay ink.
const GAME_MARK_COLOR: Record<string, string> = {
  'one-piece': '#B7791F',
  'yu-gi-oh': '#6B21A8',
  'magic-the-gathering': '#1D4ED8',
  riftbound: '#0891B2',
  'disney-lorcana': '#4338CA',
  gundam: '#DC2626',
  'flesh-and-blood': '#9F1239',
  'star-wars-unlimited': '#16A34A',
  digimon: '#EA580C',
  'dragon-ball-super': '#B45309',
  'weiss-schwarz': '#334155',
  'cardfight-vanguard': '#0D9488',
  'union-arena': '#DB2777',
  'sports-cards': '#0369A1',
};

// Aspect ratios (w/h) taken from each downloaded file's viewBox. Hard-coded so
// the box reserves its final width during SSR — measuring the SVG on the client
// would reflow the whole icon row on first paint.
//
// Only square SYMBOLS earn a slot here. Dragon Ball, Star Wars, Magic, Digimon
// and One Piece publish wordmarks — they set the game's name above a label
// already carrying it, in brand colours that fight the drawn marks beside them.
// They were downloaded, rejected, and are documented with their sources in
// `public/games/SOURCES.md` should a square symbol ever ship.
//
// EVERY GAME BUT DIGIMON. Each is the published symbol, traced into a minimal
// SVG from a reference supplied by the product owner (provenance per file in
// `public/games/SOURCES.md`). Digimon publishes only a wordmark and stays on the
// drawn digivice until a symbol reference turns up.
const GAME_LOGO_ASPECT: Record<string, number> = {
  pokemon: 1,
  'magic-the-gathering': 1,
  riftbound: 1,
  'disney-lorcana': 1,
  'one-piece': 1,
  'yu-gi-oh': 1,
  gundam: 1,
  'flesh-and-blood': 1,
  'star-wars-unlimited': 1,
  'dragon-ball-super': 1,
  'weiss-schwarz': 1,
  'cardfight-vanguard': 1,
  'union-arena': 1,
};

// One shared band height keeps logos and drawn marks on the same baseline, so
// a row mixing the two stays even. The width cap stops the 5.49:1 One Piece
// wordmark from blowing out a grid column; `object-contain` shrinks it to fit.
const LOGO_HEIGHT_PX = 20;
const LOGO_MAX_WIDTH_PX = 52;

export function GameMark({
  slug,
  className,
}: {
  slug: string;
  className?: string;
}) {
  if (slug === 'all') {
    return <HugeiconsIcon icon={LayoutGridIcon} className={cn('size-3.5 shrink-0', className)} aria-hidden />;
  }
  const Mark = GAME_MARKS[slug] ?? OtherTcgMark;
  return <Mark className={className} />;
}

export function GameIcon({
  slug,
  className,
  active = false,
}: {
  slug: string;
  className?: string;
  /** Drives the icon's own treatment: brand logos dim when inactive, drawn
   *  marks switch to iris. Callers only need to say which state they're in. */
  active?: boolean;
}) {
  const aspect = GAME_LOGO_ASPECT[slug];

  if (aspect == null) {
    const color = GAME_MARK_COLOR[slug];
    return (
      <span
        className={cn(
          'inline-grid shrink-0 place-items-center',
          // A coloured mark behaves like the Poké Ball logo beside it: it keeps its
          // hue in both states and only loses a little presence when inactive. An
          // uncoloured mark (a category, not a game) still follows the state.
          color ? !active && 'opacity-80' : active ? 'text-iris-ink' : 'text-muted-foreground',
          className,
        )}
        style={{ height: LOGO_HEIGHT_PX, width: LOGO_HEIGHT_PX, color }}
      >
        <GameMark slug={slug} className="size-4" />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center',
        // A brand logo carries its own colour, so state lives on the label and
        // underline instead. Inactive only loses a little presence — tinting or
        // heavy fading would misrepresent the mark, and the lighter logos
        // (Magic, Digimon) turn to mush below about 80%.
        !active && 'opacity-80',
        className,
      )}
      // Geometry is inline so a caller's `size-4` cannot squash a wordmark into
      // a square; the class still lands for spacing and layout.
      style={{
        height: LOGO_HEIGHT_PX,
        width: Math.min(LOGO_HEIGHT_PX * aspect, LOGO_MAX_WIDTH_PX),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local static SVG; next/image would need `dangerouslyAllowSVG` and cannot optimise vectors anyway */}
      <img
        src={`/games/${slug}.svg`}
        alt=""
        className="size-full object-contain"
        // Not the LCP element. Eager loads here become `<link rel="preload">`
        // for every game, including the strip hidden at the other breakpoint,
        // and they compete with the card covers.
        loading="lazy"
        decoding="async"
        fetchPriority="low"
      />
    </span>
  );
}
