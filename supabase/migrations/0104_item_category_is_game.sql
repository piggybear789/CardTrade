-- items.category is the card game (Pokémon, Sports Cards, …), not a collectible
-- type. Demo rows still labelled Trading Cards / Pokémon-in-title are remapped.
-- Comics, stamps, coins, and memorabilia stay as historical rows and are
-- excluded from the public catalog in application queries.

update cardtrade.items
set category = 'Pokémon'
where category is distinct from 'Pokémon'
  and title ~* 'pok[eé]mon';

update cardtrade.items
set category = 'Sports Cards'
where category = 'Trading Cards';
