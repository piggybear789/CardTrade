-- 0164_reference_integrity.sql
--
-- References (0155) hardening, from the 2026-10-28 review.
--
-- BANS AND CLOSURES NO LONGER HIDE WARNINGS. A fraud ban marked every edge the member
-- gave or received REMOVED and left their handles claimed by the banned profile, which
-- every reader filters out: the scammer's Instagram handle vanished from the graph and
-- could take no new experience. Now, on a fraud ban OR an account closure:
--   * a ban still removes every reference the member GAVE and every POSITIVE one they
--     received (a banned person vouches for nobody and is vouched for by nobody);
--   * the remaining received references (negative and so-so; on closure, all of them)
--     move back onto the member's claimed handle on the platform the deal was on, else
--     their first claimed handle, so the warning stays where people will look;
--   * every handle they claimed is released to an unclaimed node, so it can be found,
--     can take new experiences, and can be claimed again by whoever proves it.
--
-- NO OWNERSHIP FROM A TYPED LINK. The 0155 backfill made a claim out of whatever a
-- member had typed into `profiles.social_links`, with no proof they own the account,
-- and the first member to type a handle won it. Those PROFILE_LINK claims are demoted to
-- unclaimed nodes; the owner claims by DM, OAuth or a staff-checked request. Handles the
-- backfill stored with a leading `@` are normalised so a lookup can reach them.
--
-- REPEAT DEALS ARE BOUNDED BY THE CALENDAR. `deals_through` is the latest month a deal
-- was counted for. A new deal counts only for a month after it, and editing a
-- reference's month never lowers it, so rewinding the month and re-posting no longer
-- adds deals.
--
-- CLAIMS DO NOT COLLIDE. Two accounts of one person could each hold a live edge to the
-- same unclaimed handle; moving both onto the claimant broke the person-pair index and
-- the claim failed every time. They now fold into one before the move.
--
-- STAFF TAKEDOWN. A reference staff remove records who and when (`removed_by`,
-- `removed_at`). The never-written dispute columns are dropped.

alter table cardtrade.member_references
  add column if not exists deals_through date,
  add column if not exists removed_by uuid references cardtrade.profiles(id) on delete set null,
  add column if not exists removed_at timestamptz;

update cardtrade.member_references
   set deals_through = occurred_month
 where deals_through is null;

alter table cardtrade.member_references
  drop column if exists disputed_at,
  drop column if exists disputed_by;

comment on column cardtrade.member_references.deals_through is
  'Latest month a deal was counted for (0164). Only a later month adds a deal; edits never lower it.';
comment on column cardtrade.member_references.removed_by is
  'Staff member who removed the reference (0164). Null when the author withdrew it or a trigger removed it.';

-- ---------------------------------------------------------------------------
-- Typed-link claims are not ownership.
-- ---------------------------------------------------------------------------
update cardtrade.social_claims
   set claimed_profile_id = null,
       claimed_at = null,
       claim_method = 'UNCLAIMED',
       updated_at = now()
 where claim_method = 'PROFILE_LINK';

update cardtrade.social_claims c
   set handle = regexp_replace(c.handle, '^@+', ''),
       updated_at = now()
 where c.handle like '@%'
   and char_length(regexp_replace(c.handle, '^@+', '')) > 0
   and not exists (
     select 1 from cardtrade.social_claims o
      where o.platform = c.platform
        and o.handle_norm = lower(btrim(regexp_replace(c.handle, '^@+', '')))
   );

-- ---------------------------------------------------------------------------
-- Ban or closure: release the handles, keep the warnings on them.
-- ---------------------------------------------------------------------------
create or replace function cardtrade.profiles_remove_from_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_banned boolean := new.fraud_banned_at is not null and old.fraud_banned_at is null;
  v_edge record;
  v_claim uuid;
  v_existing uuid;
begin
  if v_banned then
    update cardtrade.member_references
       set status = 'REMOVED',
           updated_at = now()
     where status = 'LIVE'
       and (voucher_id = new.id or (target_profile_id = new.id and sentiment = 'POSITIVE'));
  end if;

  for v_edge in
    select m.id, m.voucher_id, m.platform, m.sentiment, m.deal_count
      from cardtrade.member_references m
     where m.status = 'LIVE'
       and m.target_profile_id = new.id
     order by m.created_at
  loop
    select c.id
      into v_claim
      from cardtrade.social_claims c
     where c.claimed_profile_id = new.id
     order by (c.platform = v_edge.platform) desc, c.claimed_at, c.id
     limit 1;

    if v_claim is null then
      -- Nowhere public to keep it. A ban ends it; a closed member's page is gone anyway.
      if v_banned then
        update cardtrade.member_references
           set status = 'REMOVED',
               updated_at = now()
         where id = v_edge.id;
      end if;
      continue;
    end if;

    select e.id
      into v_existing
      from cardtrade.member_references e
     where e.status = 'LIVE'
       and e.target_claim_id = v_claim
       and e.voucher_id = v_edge.voucher_id
       and e.sentiment = v_edge.sentiment
     limit 1;

    if v_existing is not null then
      update cardtrade.member_references
         set deal_count = deal_count + v_edge.deal_count,
             updated_at = now()
       where id = v_existing;
      update cardtrade.member_references
         set status = 'REMOVED',
             updated_at = now()
       where id = v_edge.id;
    else
      update cardtrade.member_references
         set target_profile_id = null,
             target_claim_id = v_claim,
             target_person_key = null,
             updated_at = now()
       where id = v_edge.id;
    end if;
  end loop;

  update cardtrade.social_claims
     set claimed_profile_id = null,
         claimed_at = null,
         claim_method = 'UNCLAIMED',
         updated_at = now()
   where claimed_profile_id = new.id;

  return null;
end;
$function$;

drop trigger if exists profiles_remove_from_references on cardtrade.profiles;
create trigger profiles_remove_from_references
  after update of fraud_banned_at, closed_at on cardtrade.profiles
  for each row
  when (
    (new.fraud_banned_at is not null and old.fraud_banned_at is null)
    or (new.closed_at is not null and old.closed_at is null)
  )
  execute function cardtrade.profiles_remove_from_references();

-- ---------------------------------------------------------------------------
-- Claiming: fold one person's duplicate handle edges before the move (0162 + fix).
-- ---------------------------------------------------------------------------
create or replace function cardtrade.social_claims_move_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key text;
  v_edge record;
  v_existing uuid;
begin
  if new.claimed_profile_id is null
     or (tg_op = 'UPDATE' and old.claimed_profile_id is not distinct from new.claimed_profile_id) then
    return new;
  end if;

  v_key := cardtrade.person_key_for(new.claimed_profile_id);

  -- The claimant's own references to the handle end: nobody references themselves.
  update cardtrade.member_references
     set status = 'REMOVED',
         updated_at = now()
   where target_claim_id = new.id
     and status = 'LIVE'
     and (voucher_id = new.claimed_profile_id or voucher_person_key = v_key);

  -- One person, one edge per sentiment, even from two accounts: the oldest keeps it.
  for v_edge in
    select m.id, m.voucher_person_key, m.sentiment, m.deal_count, m.created_at
      from cardtrade.member_references m
     where m.target_claim_id = new.id
       and m.status = 'LIVE'
     order by m.created_at, m.id
  loop
    select e.id
      into v_existing
      from cardtrade.member_references e
     where e.status = 'LIVE'
       and e.id <> v_edge.id
       and e.voucher_person_key = v_edge.voucher_person_key
       and e.sentiment = v_edge.sentiment
       and (
         e.target_person_key = v_key
         or e.target_profile_id = new.claimed_profile_id
         or (e.target_claim_id = new.id and (e.created_at, e.id) < (v_edge.created_at, v_edge.id))
       )
     order by (e.target_claim_id is null) desc, e.created_at
     limit 1;

    if v_existing is not null then
      update cardtrade.member_references
         set deal_count = deal_count + v_edge.deal_count,
             updated_at = now()
       where id = v_existing;
      update cardtrade.member_references
         set status = 'REMOVED',
             updated_at = now()
       where id = v_edge.id;
    end if;
  end loop;

  update cardtrade.member_references
     set target_profile_id = new.claimed_profile_id,
         target_claim_id = null,
         target_person_key = v_key,
         updated_at = now()
   where target_claim_id = new.id
     and status = 'LIVE';

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Edges moved by the 0155 trigger for a claimant with no identity keys kept a null
-- target key, which the person-pair index skips. Give them one, unless that would make
-- a second live edge for the same pair.
-- ---------------------------------------------------------------------------
update cardtrade.member_references r
   set target_person_key = cardtrade.person_key_for(r.target_profile_id),
       updated_at = now()
 where r.status = 'LIVE'
   and r.target_profile_id is not null
   and r.target_person_key is null
   and r.voucher_person_key <> cardtrade.person_key_for(r.target_profile_id)
   and not exists (
     select 1 from cardtrade.member_references o
      where o.status = 'LIVE'
        and o.id <> r.id
        and o.voucher_person_key = r.voucher_person_key
        and o.sentiment = r.sentiment
        and o.target_person_key = cardtrade.person_key_for(r.target_profile_id)
   );

revoke all on function cardtrade.social_claims_move_references() from public, anon, authenticated;
revoke all on function cardtrade.profiles_remove_from_references() from public, anon, authenticated;
