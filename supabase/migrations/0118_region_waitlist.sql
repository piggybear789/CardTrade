-- 0118_region_waitlist.sql
--
-- Members who want NoDitto in a region it is not open in yet.
--
-- WHY THIS EXISTS. Onboarding's region step offered exactly the regions a member can
-- trade in — one, Australia — and nothing else. A member signing up from anywhere else
-- had two choices: lie about where they are, or leave. Neither is useful to them and
-- neither tells us where the demand is. This table records the third choice: say
-- where you actually are, be told plainly that deals are not open there yet, and go
-- straight to browsing.
--
-- WHAT IT IS NOT. It is NOT `profiles.region_code`. That column is the member's TRADING
-- region — the jurisdiction their payout account is registered in and the contract
-- guards read — and 0070's trigger refuses a region that is not open for deals there,
-- for the reason it gives: a trading region that cannot settle badges a member ready
-- to trade and then fails every contract. A waitlisted member therefore has NO trading
-- region. They browse; they do not buy, sell or trade; and when their region opens,
-- this table is the list of who to tell and who to move.
--
-- One row per (member, region). A member may wait for more than one region — an
-- Australian collector who also wants New Zealand — so the key is the pair, not the
-- member. The row is a fact about demand, so it is never updated: joining again is a
-- no-op and there is nothing to edit.

create table cardtrade.region_waitlist (
  profile_id uuid not null references cardtrade.profiles(id) on delete cascade,
  region_code text not null references cardtrade.regions(code),
  created_at timestamptz not null default now(),
  primary key (profile_id, region_code)
);

-- The operator's read is "who is waiting for GB", so the second key column gets its
-- own index; the primary key already serves "what is this member waiting for".
create index region_waitlist_region_idx
  on cardtrade.region_waitlist (region_code);

-- ---------------------------------------------------------------------------
-- The guard: a waitlist is for regions that are NOT open.
-- ---------------------------------------------------------------------------
--
-- Mirrors `joinRegionWaitlist` in the database, per the enforce-twice convention. A
-- member can only reach this table through the action, but the grant below makes the
-- row writable by anything holding their JWT, so the action's refusal is advisory on
-- its own. Waiting for a region that is already open is not harmful, but it is a
-- state that means nothing — the member should have chosen it as their trading region
-- — and a meaningless row is exactly the thing that gets read as demand later.
create or replace function cardtrade.enforce_region_waitlist_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  select r.trading_enabled into v_enabled
  from cardtrade.regions r
  where r.code = new.region_code;

  if v_enabled is null then
    raise exception 'Unknown region: %', new.region_code
      using errcode = 'check_violation';
  end if;

  if v_enabled then
    raise exception 'Region % is open for deals; choose it as your trading region instead.',
      new.region_code
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function cardtrade.enforce_region_waitlist_rules() is
  'Refuses a waitlist row for a region that is already trading_enabled. Mirrors '
  'joinRegionWaitlist; needed because the insert grant makes the action''s own check '
  'bypassable by a direct insert carrying the member''s JWT.';

drop trigger if exists region_waitlist_enforce_rules on cardtrade.region_waitlist;

create trigger region_waitlist_enforce_rules
  before insert on cardtrade.region_waitlist
  for each row
  execute function cardtrade.enforce_region_waitlist_rules();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table cardtrade.region_waitlist enable row level security;

-- A member sees and adds their OWN rows only. There is no update or delete policy
-- because there is nothing to update and leaving a waitlist is not a flow the product
-- offers; the operator's read is through the service role.
create policy region_waitlist_owner_select
  on cardtrade.region_waitlist for select to authenticated
  using ((select auth.uid()) = profile_id);

create policy region_waitlist_owner_insert
  on cardtrade.region_waitlist for insert to authenticated
  with check ((select auth.uid()) = profile_id);

-- Table-level grants, matching 0113's saved-address book: RLS decides WHICH row, these
-- decide WHAT a member may do to it. `tests/database/grants.test.ts` pins both
-- directions — insert and select must work, update and delete must not.
revoke all on cardtrade.region_waitlist from anon, authenticated;
grant select, insert on cardtrade.region_waitlist to authenticated;
grant all on cardtrade.region_waitlist to service_role;

comment on table cardtrade.region_waitlist is
  'Members waiting for NoDitto to open in a region (one row per member per region). '
  'NOT the trading region: a waitlisted member has no profiles.region_code and can '
  'browse but not transact. Read by operators to decide which region opens next and '
  'who to tell when it does.';
