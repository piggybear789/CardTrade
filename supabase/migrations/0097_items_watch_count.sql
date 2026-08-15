-- 0097_items_watch_count.sql
--
-- A PUBLIC want-count on items, so the catalog tile can say how many members have
-- saved a listing (the "N people want this" figure on the reference marketplace).
--
-- WHY THIS IS DENORMALISED RATHER THAN COUNTED AT READ TIME. `watchlist` carries
-- `watchlist_owner_all` (0076, reworked in 0078), which restricts every row to its
-- own user — deliberately, because who else is watching an item is nobody's
-- business. So `count(*)` through the cookie-bound client returns the VIEWER'S OWN
-- rows and nothing else: it answers 0 or 1 on every listing in the catalog and looks
-- like a working feature. A public aggregate over a privately-scoped table has to be
-- maintained above the row, which is what this column is.
--
-- The counter is kept by trigger rather than recomputed, because the catalog grid
-- reads it once per tile per page and an aggregate subquery there is a join over the
-- whole watchlist on the hottest query in the app.

alter table cardtrade.items
  add column if not exists watch_count integer not null default 0;

-- SECURITY DEFINER is required, not decorative. A member holds
-- `grant insert (user_id, item_id) on watchlist` (0077) and NO update grant on
-- `items` at all — correctly, since they must not be able to edit somebody else's
-- listing. The counter therefore cannot be maintained with the caller's privileges,
-- and `search_path` is pinned so the definer cannot be redirected at a shadowed
-- table.
create or replace function cardtrade.sync_item_watch_count()
returns trigger
language plpgsql
security definer
set search_path = cardtrade, public
as $$
begin
  if tg_op = 'INSERT' then
    update cardtrade.items
      set watch_count = watch_count + 1
      where id = new.item_id;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Floored at zero so a double-delete or a manual row removal cannot drive the
    -- displayed figure negative. The count is a display affordance, not a ledger:
    -- being briefly low is acceptable where showing "-1 people want this" is not.
    update cardtrade.items
      set watch_count = greatest(watch_count - 1, 0)
      where id = old.item_id;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists watchlist_sync_item_watch_count on cardtrade.watchlist;
create trigger watchlist_sync_item_watch_count
  after insert or delete on cardtrade.watchlist
  for each row execute function cardtrade.sync_item_watch_count();

-- Backfill from the rows that already exist, so the column is true the moment it
-- ships rather than only counting saves made from now on.
update cardtrade.items i
   set watch_count = coalesce(w.c, 0)
  from (
    select item_id, count(*)::integer as c
      from cardtrade.watchlist
     group by item_id
  ) w
 where w.item_id = i.id
   and i.watch_count <> coalesce(w.c, 0);

-- Column grants last, because the identity-gate property test parses migration text
-- and `grant select (col)` contains a literal the trigger-function regex matches.
--
-- THIS GRANT IS LOAD-BEARING, not housekeeping. `items` is granted column by column
-- (0091), and the catalog reads it with `select('*')`, which expands to every column
-- and needs the privilege on each one. A new column without its grant does not
-- degrade to a missing figure — it fails the whole catalog query.
grant select (watch_count) on cardtrade.items to authenticated, anon;
