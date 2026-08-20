// Monochrome marks for catalog game pills. Drawn as simple geometry so they
// read at 14px and inherit the pill colour. These are original symbols, not
// official logos.

import type { ReactNode, SVGProps } from 'react';
import { LayoutGrid } from 'lucide-react';

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

function OnePieceMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <ellipse cx="8" cy="10.4" rx="6.2" ry="1.55" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M3.4 10.1C3.6 6.6 5.4 4.1 8 4.1s4.4 2.5 4.6 6"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M5.1 7.6h5.8" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  );
}

function YuGiOhMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path
        d="M8 2.2 13.4 14H2.6L8 2.2Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M8 6.4 10.6 12H5.4L8 6.4Z" fill="currentColor" />
    </svg>
  );
}

function MagicMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path
        d="M8 1.6 9.1 6.2 13.8 5.1 10.2 8 13.8 10.9 9.1 9.8 8 14.4 6.9 9.8 2.2 10.9 5.8 8 2.2 5.1 6.9 6.2 8 1.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

function RiftboundMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path
        d="M8 1.8 13.6 5v6L8 14.2 2.4 11V5L8 1.8Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M8 5.2v5.6M5.4 6.7 8 8.2l2.6-1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function LorcanaMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path
        d="M8 2.2c2.4 2.4 3.8 4.4 3.8 6.4A3.8 3.8 0 1 1 8 4.8"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M8 1.6v3.1M6.4 3.2l3.2 0" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function GundamMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path d="M8 2.2 3.2 6.4h9.6L8 2.2Z" fill="currentColor" />
      <path
        d="M4.1 6.4h7.8v6.2c0 .7-3.9 1.6-3.9 1.6s-3.9-.9-3.9-1.6V6.4Z"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function FleshAndBloodMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <path
        d="M8 14.2 3.4 8.8a3.2 3.2 0 0 1 4.6-4.5L8 4.6l.1.1a3.2 3.2 0 0 1 4.5 4.5L8 14.2Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StarWarsMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2.1" fill="currentColor" />
      <path
        d="M8 1.8v3.2M8 11v3.2M1.8 8h3.2M11 8h3.2"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function DigimonMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <rect
        x="2.2"
        y="3.4"
        width="11.6"
        height="9.2"
        rx="2.4"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="8" cy="8" r="2.3" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function DragonBallMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M6.1 5.3 6.6 6.7 8 7l-1.4.4-.4 1.4-.5-1.4L4.3 7l1.4-.3.4-1.4Zm4.3 0 .5 1.4L12.3 7l-1.4.4-.5 1.4-.4-1.4L8.6 7l1.4-.3.4-1.4ZM8 8.7l.5 1.4 1.4.3-1.4.4-.5 1.4-.4-1.4-1.4-.4 1.4-.3.4-1.4Z"
        fill="currentColor"
      />
    </svg>
  );
}

function WeissMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <circle cx="6" cy="8" r="4.1" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10" cy="8" r="4.1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function VanguardMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 3.6 11.4 12H4.6L8 3.6Z" fill="currentColor" />
    </svg>
  );
}

function UnionArenaMark(props: IconProps) {
  return (
    <svg {...mark(props)}>
      <rect x="2.4" y="2.4" width="7.4" height="7.4" rx="1.1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6.2" y="6.2" width="7.4" height="7.4" rx="1.1" stroke="currentColor" strokeWidth="1.3" />
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

export function GameIcon({
  slug,
  className,
}: {
  slug: string;
  className?: string;
}) {
  if (slug === 'all') {
    return <LayoutGrid className={cn('size-3.5 shrink-0', className)} aria-hidden />;
  }
  const Mark = GAME_MARKS[slug] ?? OtherTcgMark;
  return <Mark className={className} />;
}
