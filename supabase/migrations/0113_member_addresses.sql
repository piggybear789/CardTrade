-- 0113_member_addresses.sql
--
-- A member's PRIVATE saved-address book: a convenience list of provider-resolved
-- postal addresses a member can reuse when a purchase or trade needs one, so they
-- do not retype it into every contract.
--
-- This is DISTINCT from the per-contract delivery address. A contract's delivery
-- address (cash_sale_delivery_details / trade_delivery_details) is sensitive
-- per-contract data disclosed only under existing rules. A saved address is only
-- ever a SOURCE the member copies from into a contract; it is never auto-disclosed
-- to a counterparty and is never exposed through cardtrade.public_profiles.
--
-- Column shape mirrors cash_sale_delivery_details / trade_delivery_details so the
-- same provider-resolved place (address_label / place_id / country_code /
-- latitude / longitude) copies straight across without a mapping.

create table cardtrade.member_addresses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references cardtrade.profiles(id) on delete cascade,
  -- A human label the member gives the entry ("Home", "Work"), NOT the address
  -- itself. Optional; falls back to the resolved address label in the UI.
  label text check (label is null or char_length(btrim(label)) between 1 and 120),
  -- Provider-resolved place fields, matching the per-contract delivery tables.
  address_label text not null check (char_length(btrim(address_label)) between 1 and 1000),
  place_id text not null check (
    char_length(btrim(place_id)) between 1 and 255
    and place_id not like 'text:%'
    and place_id not like 'legacy:%'
  ),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  latitude double precision,
  longitude double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_addresses_coords_check check (
    (latitude is null and longitude is null)
    or (
      latitude between -90 and 90
      and longitude between -180 and 180
    )
  )
);

create index member_addresses_owner_idx
  on cardtrade.member_addresses (owner_id);

-- At most one default per member. A partial unique index lets many non-default
-- rows coexist while guaranteeing the "default" is unambiguous.
create unique index member_addresses_one_default_idx
  on cardtrade.member_addresses (owner_id)
  where is_default;

alter table cardtrade.member_addresses enable row level security;

-- A member may only ever see and mutate their OWN saved addresses. There is no
-- counterparty disclosure here at all: this book is never read by anyone but its
-- owner. Per-contract disclosure lives on the delivery-detail tables instead.
create policy member_addresses_owner_select
  on cardtrade.member_addresses for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy member_addresses_owner_insert
  on cardtrade.member_addresses for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy member_addresses_owner_update
  on cardtrade.member_addresses for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy member_addresses_owner_delete
  on cardtrade.member_addresses for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on cardtrade.member_addresses from anon, authenticated;
grant select, insert, update, delete on cardtrade.member_addresses to authenticated;
grant all on cardtrade.member_addresses to service_role;

comment on table cardtrade.member_addresses is
  'Private per-member saved-address book. A convenience SOURCE a member copies from into a contract; never auto-disclosed to a counterparty and never exposed via public_profiles. Distinct from the per-contract delivery address (cash_sale_delivery_details / trade_delivery_details).';
comment on column cardtrade.member_addresses.label is
  'Optional member-given name for the entry (e.g. Home, Work). Not the address text.';
comment on column cardtrade.member_addresses.is_default is
  'The member''s preferred address, prefilled first. At most one per owner (member_addresses_one_default_idx).';
