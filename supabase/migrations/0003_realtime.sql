-- CardTrade — 0003_realtime.sql
-- Enable Supabase Realtime (Postgres Changes) for the live Trade Contract view.
--
-- The real-time trade contract view (Req 11) subscribes to Postgres Changes on
-- the `trades` row and its associated `pre_auth_holds`. For those changes to be
-- streamed over Realtime, both tables must belong to the `supabase_realtime`
-- publication. Source approach: Supabase — Subscribing to Database Changes.
--
-- Notes:
--   * The `supabase_realtime` publication normally already exists in a Supabase
--     project; we create it defensively for environments where it does not
--     (e.g. a bare Postgres used for local testing).
--   * Adding a table that is already a member of a publication raises an error,
--     so each ADD TABLE is guarded to keep this migration idempotent.
--   * REPLICA IDENTITY FULL makes the previous row values available on UPDATE
--     and DELETE change events, so subscribers receive complete old/new records
--     (e.g. a hold's prior status) rather than only the primary key.

-- Ensure the Realtime publication exists (no-op when Supabase already created it).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

-- Emit full row images on updates/deletes for the realtime-tracked tables.
alter table trades         replica identity full;
alter table pre_auth_holds replica identity full;

-- Add `trades` to the publication if it is not already a member.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trades'
  ) then
    alter publication supabase_realtime add table trades;
  end if;
end
$$;

-- Add `pre_auth_holds` to the publication if it is not already a member.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pre_auth_holds'
  ) then
    alter publication supabase_realtime add table pre_auth_holds;
  end if;
end
$$;
