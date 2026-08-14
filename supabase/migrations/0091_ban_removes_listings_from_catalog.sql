-- 0091_ban_removes_listings_from_catalog.sql
--
-- A permanently banned fraudster's listings were still purchasable by everyone else.
--
-- 0059 made a ban thorough from the BANNED member's side: a restrictive
-- `fraud_banned_no_access` policy on nineteen tables blocks every row operation they
-- attempt. It said nothing about what OTHER members can still see, and
-- `items_catalog_select` grants any AVAILABLE, unclosed item to everyone. So after a
-- staff-confirmed Objective_Fraud finding — the platform's most serious determination,
-- which permanently bans the account — that account's inventory stayed in the catalog
-- and remained openable as a contract by any buyer.
--
-- FOUND WHILE AUDITING RETURN-CONDITIONAL REFUNDS (0088), and PRE-EXISTING rather than
-- caused by it: the ordinary full-refund path has always relisted through the same
-- helper. What 0088 changed is how routine relisting became, so the gap stopped being
-- theoretical.
--
-- WHY THE POLICY AND NOT THE RELIST CALL SITES. Every path that sets an item back to
-- AVAILABLE would otherwise have to remember this, and so would every future one. More
-- decisively, a ban must hide listings that were ALREADY available when it landed, and
-- no relist call site is ever reached for those. Visibility is the invariant, so it
-- belongs where visibility is decided.
--
-- WHY A DENORMALISED COLUMN AND NOT A FUNCTION CALL IN THE POLICY. The first attempt
-- added `profile_is_fraud_banned(uuid)` as SECURITY DEFINER and granted EXECUTE to
-- `anon`, because an anonymous visitor browses the catalog and a policy's function
-- calls need EXECUTE for the calling role. `tests/database/grants.test.ts` refused it,
-- correctly. Its three allowed exceptions — `is_admin`, `is_staff`, `is_fraud_banned` —
-- all answer about the CALLER and take no argument. A function taking an arbitrary
-- profile id would have let anyone holding the publishable key probe any member's ban
-- status one id at a time, which is a fraud determination about a person.
--
-- `items.seller_identity_verified` already exists for this exact shape of problem: the
-- catalog policy needs a fact about the seller without granting readers access to
-- profiles. This follows it.

alter table cardtrade.items
  add column if not exists seller_fraud_banned boolean not null default false;

comment on column cardtrade.items.seller_fraud_banned is
  'Denormalised from profiles.fraud_banned_at so the catalog policy can exclude a '
  'banned members goods without readers holding profile access. Maintained by trigger '
  'in both directions; never written by hand.';

-- Backfill before the policy depends on it.
update cardtrade.items item
set seller_fraud_banned = true
from cardtrade.profiles profile
where profile.id = item.owner_id
  and profile.fraud_banned_at is not null
  and item.seller_fraud_banned is distinct from true;

-- Keep it true to the profile. Separate from the identity-verification trigger on
-- purpose: they answer different questions, and merging them would put one column's
-- correctness at the mercy of the other's condition.
create or replace function cardtrade.sync_items_seller_fraud_banned()
returns trigger
language plpgsql
security definer
set search_path = cardtrade, pg_temp
as $$
begin
  update cardtrade.items
  set seller_fraud_banned = new.fraud_banned_at is not null
  where owner_id = new.id
    and seller_fraud_banned is distinct from (new.fraud_banned_at is not null);
  return new;
end;
$$;

drop trigger if exists items_seller_fraud_banned_sync on cardtrade.profiles;
create trigger items_seller_fraud_banned_sync
  after update of fraud_banned_at on cardtrade.profiles
  for each row
  execute function cardtrade.sync_items_seller_fraud_banned();

-- A new listing inherits the owner's current state, so a banned member cannot publish
-- into the catalog by creating rows after the ban.
create or replace function cardtrade.set_item_seller_fraud_banned()
returns trigger
language plpgsql
security definer
set search_path = cardtrade, pg_temp
as $$
begin
  new.seller_fraud_banned := exists (
    select 1
    from cardtrade.profiles profile
    where profile.id = new.owner_id
      and profile.fraud_banned_at is not null
  );
  return new;
end;
$$;

drop trigger if exists items_set_seller_fraud_banned on cardtrade.items;
create trigger items_set_seller_fraud_banned
  before insert on cardtrade.items
  for each row
  execute function cardtrade.set_item_seller_fraud_banned();

drop policy if exists items_catalog_select on cardtrade.items;
create policy items_catalog_select
  on cardtrade.items
  for select
  using (
    (
      status = 'AVAILABLE'::cardtrade.item_status
      and closed_at is null
      -- THE FIX. A banned account's goods leave the catalog immediately, whether they
      -- were listed before the ban or relisted by a refund afterwards.
      and seller_fraud_banned = false
    )
    -- Unchanged: an owner always sees their own rows, which keeps a seller's own
    -- listings page working for RESERVED and SOLD items. A BANNED owner is already
    -- stopped by the restrictive fraud_banned_no_access policy from 0059, so this
    -- branch cannot be used to reach around the line above.
    or owner_id = (select auth.uid())
  );

-- The failed first attempt, removed rather than left callable.
drop function if exists cardtrade.profile_is_fraud_banned(uuid);

-- Column grants last, because the identity-gate property test parses migration text
-- and `grant select (col)` contains a literal the trigger-function regex matches.
grant select (seller_fraud_banned) on cardtrade.items to authenticated, anon;
