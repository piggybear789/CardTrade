import Image from 'next/image';

import { cn } from '@/lib/utils';

const DITTO_ARTWORK = {
  classic: {
    src: 'https://images.pokemontcg.io/base3/3_hires.png',
    alt: 'Ditto from the Pokémon Fossil trading card set',
  },
  duplicate: {
    src: 'https://images.pokemontcg.io/pop3/12.png',
    alt: 'Ditto using its Duplicate ability on a Pokémon trading card',
  },
  detective: {
    src: 'https://images.pokemontcg.io/det1/17.png',
    alt: 'Ditto from the Detective Pikachu trading card set',
  },
} as const;

export type DittoArtworkVariant = keyof typeof DITTO_ARTWORK;

export function DittoArtwork({
  variant = 'classic',
  className,
  imageClassName,
  sizes = '(max-width: 639px) 42vw, 14rem',
  priority = false,
  decorative = false,
}: {
  variant?: DittoArtworkVariant;
  className?: string;
  imageClassName?: string;
  sizes?: string;
  priority?: boolean;
  decorative?: boolean;
}) {
  const artwork = DITTO_ARTWORK[variant];

  return (
    <div
      className={cn(
        'noditto-character relative overflow-hidden rounded-xl border',
        className,
      )}
    >
      <Image
        src={artwork.src}
        alt={decorative ? '' : artwork.alt}
        width={488}
        height={680}
        sizes={sizes}
        priority={priority}
        className={cn('h-auto w-full', imageClassName)}
      />
    </div>
  );
}
