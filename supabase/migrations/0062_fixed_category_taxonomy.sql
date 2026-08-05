-- 0062: Fixed two-level category taxonomy for collectibles.
--
-- Introduces a `categories` table with a self-referencing parent_id for the
-- two-level hierarchy. Users cannot create categories — they are seeded here
-- and managed by staff via migrations only.
--
-- Items gain a `category_id` FK pointing to a LEAF (subcategory) row. The
-- existing free-text `category` column is kept for now as a denormalised label
-- but will be dropped in a future migration once all reads are migrated.

-- 1. Create the categories table.
create table cardtrade.categories (
  id         serial primary key,
  name       text not null,
  slug       text not null unique,
  parent_id  integer references cardtrade.categories(id),
  sort_order integer not null default 0,

  constraint categories_name_not_empty check (char_length(name) >= 1),
  constraint categories_slug_not_empty check (char_length(slug) >= 1)
);

comment on table cardtrade.categories is
  'Fixed two-level collectible taxonomy. Top-level rows have parent_id = null; subcategories reference their parent.';

-- 2. Seed the fixed taxonomy.
-- Top-level categories
insert into cardtrade.categories (name, slug, sort_order) values
  ('Trading Cards',     'trading-cards',     1),
  ('Coins & Banknotes', 'coins-banknotes',   2),
  ('Stamps',            'stamps',            3),
  ('Comics',            'comics',            4),
  ('Memorabilia',       'memorabilia',       5),
  ('Figurines & Toys',  'figurines-toys',    6);

-- Subcategories: Trading Cards
insert into cardtrade.categories (name, slug, parent_id, sort_order) values
  ('Pokémon',                  'pokemon',             (select id from cardtrade.categories where slug = 'trading-cards'), 1),
  ('Magic: The Gathering',     'magic-the-gathering', (select id from cardtrade.categories where slug = 'trading-cards'), 2),
  ('Yu-Gi-Oh!',               'yu-gi-oh',            (select id from cardtrade.categories where slug = 'trading-cards'), 3),
  ('Sports Cards',             'sports-cards',        (select id from cardtrade.categories where slug = 'trading-cards'), 4),
  ('Other TCG',                'other-tcg',           (select id from cardtrade.categories where slug = 'trading-cards'), 5);

-- Subcategories: Coins & Banknotes
insert into cardtrade.categories (name, slug, parent_id, sort_order) values
  ('Coins',            'coins',           (select id from cardtrade.categories where slug = 'coins-banknotes'), 1),
  ('Banknotes',        'banknotes',       (select id from cardtrade.categories where slug = 'coins-banknotes'), 2),
  ('Tokens & Medals',  'tokens-medals',   (select id from cardtrade.categories where slug = 'coins-banknotes'), 3);

-- Subcategories: Stamps
insert into cardtrade.categories (name, slug, parent_id, sort_order) values
  ('Australian',         'stamps-australian',    (select id from cardtrade.categories where slug = 'stamps'), 1),
  ('International',      'stamps-international', (select id from cardtrade.categories where slug = 'stamps'), 2),
  ('First Day Covers',   'first-day-covers',    (select id from cardtrade.categories where slug = 'stamps'), 3);

-- Subcategories: Comics
insert into cardtrade.categories (name, slug, parent_id, sort_order) values
  ('Single Issues',    'single-issues',    (select id from cardtrade.categories where slug = 'comics'), 1),
  ('Graphic Novels',   'graphic-novels',   (select id from cardtrade.categories where slug = 'comics'), 2),
  ('Manga',            'manga',            (select id from cardtrade.categories where slug = 'comics'), 3);

-- Subcategories: Memorabilia
insert into cardtrade.categories (name, slug, parent_id, sort_order) values
  ('Sports',         'memorabilia-sports',        (select id from cardtrade.categories where slug = 'memorabilia'), 1),
  ('Entertainment',  'memorabilia-entertainment', (select id from cardtrade.categories where slug = 'memorabilia'), 2),
  ('Historical',     'memorabilia-historical',    (select id from cardtrade.categories where slug = 'memorabilia'), 3),
  ('Autographs',     'autographs',               (select id from cardtrade.categories where slug = 'memorabilia'), 4);

-- Subcategories: Figurines & Toys
insert into cardtrade.categories (name, slug, parent_id, sort_order) values
  ('Action Figures',  'action-figures',  (select id from cardtrade.categories where slug = 'figurines-toys'), 1),
  ('Model Kits',      'model-kits',      (select id from cardtrade.categories where slug = 'figurines-toys'), 2),
  ('Plush',           'plush',           (select id from cardtrade.categories where slug = 'figurines-toys'), 3),
  ('Vintage Toys',    'vintage-toys',    (select id from cardtrade.categories where slug = 'figurines-toys'), 4);

-- 3. Add category_id FK to items, nullable during migration (existing items
--    have no ID yet). A future data migration will backfill.
alter table cardtrade.items
  add column category_id integer references cardtrade.categories(id);

-- 4. Backfill category_id from the free-text category column where the name
--    matches a top-level category. Legacy "Trading Cards" maps to its first
--    subcategory as a best-effort default; same for "Coins" → "Coins" subcategory.
update cardtrade.items set category_id = (
  select c.id from cardtrade.categories c
  where c.name = cardtrade.items.category
    and c.parent_id is not null
  limit 1
)
where category_id is null;

-- Items whose free-text matched a TOP-LEVEL name but not a subcategory: map to
-- the first subcategory of that parent.
update cardtrade.items set category_id = (
  select sub.id from cardtrade.categories sub
  inner join cardtrade.categories parent on sub.parent_id = parent.id
  where parent.name = cardtrade.items.category
  order by sub.sort_order
  limit 1
)
where category_id is null;

-- 5. RLS: categories are public read, no write via API.
alter table cardtrade.categories enable row level security;

create policy "Categories are readable by everyone"
  on cardtrade.categories for select
  using (true);

-- No insert/update/delete policies: categories are managed by migrations only.
