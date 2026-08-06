-- 0063: Expand the Trading Cards subcategories to cover the games people
-- actually trade.
--
-- 0062 seeded only Pokémon / Magic / Yu-Gi-Oh! — the historic "Big 3" — which
-- pushed everything else into "Other TCG". That is no longer where the market
-- is: One Piece has outsold a member of the Big 3 for three quarters running,
-- and Disney Lorcana and Riftbound are both top-6 product lines.
--
-- Ordering below follows TCGplayer Marketplace GMV for Q2 2026 (Apr 1 - Jun 30
-- 2026), so the dropdown puts the likely pick first rather than sorting
-- alphabetically:
--   1 Magic  2 Pokémon  3 One Piece  4 Yu-Gi-Oh!  5 Disney Lorcana
--   6 Riftbound  7 Pokémon Japan  8 Gundam  9 Dragon Ball Super  10 Digimon
-- Source: https://seller.tcgplayer.com/blog/best-selling-trading-card-games-q2-2026
-- Pokémon leads here rather than Magic because this is a consumer collectibles
-- marketplace, not a singles storefront where Commander demand dominates.
--
-- Games below the top 10 (Star Wars: Unlimited, Flesh and Blood, Union Arena,
-- Weiss Schwarz, Cardfight!! Vanguard) are included because "my game isn't
-- listed" is worse friction than a dropdown entry that stays quiet. Flesh and
-- Blood earns its slot on ANZ presence specifically — Legend Story Studios is
-- New Zealand based.
--
-- Deliberately NOT added: "Pokémon Japan", despite being a top-10 line on
-- TCGplayer. It is a language variant of a game we already list, not a
-- different game, and splitting it here would mean doing the same for every
-- other Japanese-language print run. Language belongs in its own column on
-- `items`; until it exists, Japanese cards go under Pokémon and say so in the
-- description.
--
-- No existing subcategory is RENAMED. `items.category` still stores the
-- subcategory display name as free text and `searchCatalog` filters on that
-- string, so a rename would silently orphan every listing already using it.
-- This migration only inserts new rows and re-sorts existing ones, so no
-- backfill is required.

-- Idempotent upsert: sets name, parent, and sort order whether or not the slug
-- already exists, so re-running cannot duplicate a subcategory and the two
-- rows 0062 left at sort_order 4 and 5 get moved to the end of the list.
insert into cardtrade.categories (name, slug, parent_id, sort_order) values
  ('Pokémon',              'pokemon',             (select id from cardtrade.categories where slug = 'trading-cards'),  1),
  ('Magic: The Gathering', 'magic-the-gathering', (select id from cardtrade.categories where slug = 'trading-cards'),  2),
  ('One Piece',            'one-piece',           (select id from cardtrade.categories where slug = 'trading-cards'),  3),
  ('Yu-Gi-Oh!',            'yu-gi-oh',            (select id from cardtrade.categories where slug = 'trading-cards'),  4),
  ('Disney Lorcana',       'disney-lorcana',      (select id from cardtrade.categories where slug = 'trading-cards'),  5),
  ('Riftbound',            'riftbound',           (select id from cardtrade.categories where slug = 'trading-cards'),  6),
  ('Gundam',               'gundam',              (select id from cardtrade.categories where slug = 'trading-cards'),  7),
  ('Dragon Ball Super',    'dragon-ball-super',   (select id from cardtrade.categories where slug = 'trading-cards'),  8),
  ('Digimon',              'digimon',             (select id from cardtrade.categories where slug = 'trading-cards'),  9),
  ('Star Wars: Unlimited', 'star-wars-unlimited', (select id from cardtrade.categories where slug = 'trading-cards'), 10),
  ('Flesh and Blood',      'flesh-and-blood',     (select id from cardtrade.categories where slug = 'trading-cards'), 11),
  ('Union Arena',          'union-arena',         (select id from cardtrade.categories where slug = 'trading-cards'), 12),
  ('Weiss Schwarz',        'weiss-schwarz',       (select id from cardtrade.categories where slug = 'trading-cards'), 13),
  ('Cardfight!! Vanguard', 'cardfight-vanguard',  (select id from cardtrade.categories where slug = 'trading-cards'), 14),
  ('Sports Cards',         'sports-cards',        (select id from cardtrade.categories where slug = 'trading-cards'), 15),
  ('Other TCG',            'other-tcg',           (select id from cardtrade.categories where slug = 'trading-cards'), 16)
on conflict (slug) do update
  set name       = excluded.name,
      parent_id  = excluded.parent_id,
      sort_order = excluded.sort_order;

comment on table cardtrade.categories is
  'Fixed two-level collectible taxonomy. Top-level rows have parent_id = null; subcategories reference their parent. Trading Cards subcategories are ordered by market size (TCGplayer GMV), not alphabetically — see 0063.';
