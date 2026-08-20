// Catalog and listing-form order. Headliners first; catch-alls last.
export const CARD_GAMES = [
  { name: 'Pokémon', slug: 'pokemon' },
  { name: 'One Piece', slug: 'one-piece' },
  { name: 'Yu-Gi-Oh!', slug: 'yu-gi-oh' },
  { name: 'Magic: The Gathering', slug: 'magic-the-gathering' },
  { name: 'Riftbound', slug: 'riftbound' },
  { name: 'Disney Lorcana', slug: 'disney-lorcana' },
  { name: 'Gundam', slug: 'gundam' },
  { name: 'Flesh and Blood', slug: 'flesh-and-blood' },
  { name: 'Star Wars: Unlimited', slug: 'star-wars-unlimited' },
  { name: 'Digimon', slug: 'digimon' },
  { name: 'Dragon Ball Super', slug: 'dragon-ball-super' },
  { name: 'Weiss Schwarz', slug: 'weiss-schwarz' },
  { name: 'Cardfight!! Vanguard', slug: 'cardfight-vanguard' },
  { name: 'Union Arena', slug: 'union-arena' },
  { name: 'Sports Cards', slug: 'sports-cards' },
  { name: 'Other TCG', slug: 'other-tcg' },
] as const;

export type CardGameName = (typeof CARD_GAMES)[number]['name'];

export const CARD_GAME_NAMES: CardGameName[] = CARD_GAMES.map((game) => game.name);

export function isCardGameName(value: string): value is CardGameName {
  return CARD_GAMES.some((game) => game.name === value);
}

export function cardGameName(slug: string): string {
  return CARD_GAMES.find((game) => game.slug === slug)?.name ?? slug;
}

export function cardGameSlug(name: string | null | undefined): string {
  return CARD_GAMES.find((game) => game.name === name)?.slug ?? '';
}
