-- 0106_items_image_dims.sql
--
-- The intrinsic pixel size of each listing photo, stored alongside its path so
-- the catalog can reserve the right shape before the image loads.
--
-- WHY THE DATABASE AND NOT THE IMAGE. The phone catalog is a staggered
-- two-column mosaic: each tile is as tall as its own cover photo, so the two
-- columns run out of sync. Laying that out requires the aspect ratio of every
-- visible photo AT RENDER TIME. Discovering it from the decoded image means the
-- entire grid re-flows as each photo arrives, one row shove at a time, which is
-- the exact failure the mosaic is supposed to look better than. Two integers
-- per photo, read with the row we are already reading, removes the reflow
-- completely.
--
-- WHY JSONB RATHER THAN TWO int[] COLUMNS. Both would work; jsonb wins on the
-- one property that matters here, which is per-image nullability.
--
--   * A photo whose size we do not know is normal, not exceptional: rows
--     predating this migration, seeded rows pointing at external `https://`
--     scans, and the occasional file neither reader can parse. jsonb holds a
--     literal `null` at that index. Parallel `int[]`s would need a sentinel (0
--     is not a width) or NULL array elements, which `array_length` and every
--     aggregate treat inconsistently.
--   * Two arrays means two lengths to keep equal to each other AND to
--     `image_paths`. One array means one.
--   * The column is written and read whole, never filtered or joined on, so
--     the indexing advantages of int[] buy nothing.
--
-- Entry `i` describes `image_paths[i]`. Shape: `[{"w":800,"h":1120}, null, ...]`.
--
-- NULLABLE WITH NO DEFAULT, and this is deliberate. NULL means "never
-- examined", which is what makes the backfill
-- (`scripts/backfill-image-dims.ts`) resumable — it selects the rows still NULL
-- and writes an array (of nulls if nothing could be read) so the row is not
-- reconsidered on the next run. A `default '[]'` would erase that distinction
-- on day one and make every row look already-processed. Any writer that does
-- not supply dimensions simply leaves the column NULL and the UI falls back to
-- a square tile, exactly as it did before this migration.
--
-- `image_paths` and its 1..10 length check are untouched.

alter table cardtrade.items
  add column if not exists image_dims jsonb;

-- Shape guard only. The contents are validated in application code
-- (`lib/images/dimensions.ts`) on the way in and again on the way out, because
-- part of what lands here is a claim from a browser: the direct-to-Storage
-- upload path never routes the bytes through our server, so the client is the
-- only thing that can measure them. A wrong number costs a mis-shaped tile and
-- nothing else, but a wrong TYPE would break the reader, so the array-ness is
-- enforced here where it cannot be bypassed.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'cardtrade.items'::regclass
       and conname = 'items_image_dims_is_array'
  ) then
    alter table cardtrade.items
      add constraint items_image_dims_is_array
      check (image_dims is null or jsonb_typeof(image_dims) = 'array');
  end if;
end
$$;

comment on column cardtrade.items.image_dims is
  'Intrinsic pixel size per photo, index-aligned with image_paths: [{"w":800,"h":1120}, null, ...]. '
  'NULL = never examined (backfill pending). A null entry = unknown, rendered as a square tile.';

-- Column grants last, because the identity-gate property test parses migration
-- text and `grant select (col)` contains a literal the trigger-function regex
-- matches.
--
-- THE SELECT GRANT IS LOAD-BEARING, not housekeeping. `items` is granted column
-- by column (0072/0073/0077/0091), and the catalog reads it with `select('*')`,
-- which expands to every column and needs the privilege on each one. A new
-- column without its grant does not degrade to a missing figure — it fails the
-- whole catalog query.
grant select (image_dims) on cardtrade.items to authenticated, anon;

-- INSERT only. `createItem` inserts through the cookie-bound client, so the
-- member needs the column. Edits do NOT go through that client — the item
-- orchestrator writes with the service-role binding
-- (`domain/orchestrator/supabaseItemRepository.ts`) — which is why
-- `image_paths` has no member UPDATE grant either, and why adding one for
-- `image_dims` would widen the member write surface for no caller.
grant insert (image_dims) on cardtrade.items to authenticated;
