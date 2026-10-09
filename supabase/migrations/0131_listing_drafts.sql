-- 0131_listing_drafts.sql
--
-- Saved listing drafts.
--
-- A half-written listing lived in session storage only: it never appeared anywhere as
-- something to come back to, and closing the tab lost it. Drafts are now rows a seller
-- saves on purpose and finds again under My listings.
--
-- A SEPARATE TABLE, NOT A DRAFT STATUS ON `items`. A draft has no price and no photos
-- yet, and `items` is NOT NULL on both for good reason — every contract snapshots them.
-- Loosening that table so it could also hold unfinished rows would put "is this a real
-- listing?" into every catalog, contract and payout query. A draft is the form's
-- fields as JSON, owner-only, and becomes an item only by being submitted.
--
-- Photos are not kept: they are uploaded at submit, and a draft that held uploads would
-- leave orphaned objects in Storage whenever it was abandoned.

create table if not exists cardtrade.listing_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references cardtrade.profiles (id) on delete cascade,
  fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_drafts_fields_object check (jsonb_typeof(fields) = 'object'),
  constraint listing_drafts_fields_size check (pg_column_size(fields) <= 16384)
);

comment on table cardtrade.listing_drafts is
  'Saved, unpublished listing form fields (0131). Owner-only; photos are not stored.';

create index if not exists listing_drafts_owner_idx
  on cardtrade.listing_drafts (owner_id, updated_at desc);

alter table cardtrade.listing_drafts enable row level security;

drop policy if exists listing_drafts_owner_all on cardtrade.listing_drafts;
create policy listing_drafts_owner_all on cardtrade.listing_drafts
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

grant select, insert, update, delete on cardtrade.listing_drafts to authenticated;
