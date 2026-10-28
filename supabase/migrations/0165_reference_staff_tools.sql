-- 0165_reference_staff_tools.sql
--
-- References (0155) staff tools and claim bookkeeping, from the 2026-10-28 review.
--
-- WHERE A REFERENCE WAS LEFT. `origin_claim_id` remembers the handle a reference was
-- left FOR, when it was left for a handle rather than a member. Claiming the handle moves
-- the reference onto the claimant (0155/0162) and now stamps this too, so releasing a
-- wrongly claimed handle can hand its references back to the handle instead of leaving
-- them with whoever held it. A ban or closure uses it to put a warning back on the very
-- handle it was written about.
--
-- RELEASING A HANDLE. `release_social_claim` is the staff remedy for a handle claimed by
-- the wrong member: its references go back to the handle and the claim is cleared.
-- Service role only; the admin action checks who is asking.
--
-- STAFF REMOVAL. A reference staff take down records why (`removed_reason`), alongside
-- 0164's `removed_by` / `removed_at`.
--
-- WHAT A CLAIMANT WROTE is theirs, not staff's: `claimant_message` holds the note sent
-- with a manual claim, which had been written into `staff_notes`.
--
-- A CLAIMED HANDLE CLOSES THE OTHER REQUESTS for it. Another member's pending request
-- could never be approved after someone else claimed the handle, and sat in the queue.

alter table cardtrade.member_references
  add column if not exists origin_claim_id uuid references cardtrade.social_claims(id) on delete set null,
  add column if not exists removed_reason text
    check (removed_reason is null or char_length(removed_reason) <= 500);

comment on column cardtrade.member_references.origin_claim_id is
  'The handle this reference was left for, when it was left for a handle (0165). Kept when the handle is claimed.';

create index if not exists member_references_origin_claim_idx
  on cardtrade.member_references (origin_claim_id)
  where origin_claim_id is not null and status = 'LIVE';

alter table cardtrade.handle_claim_requests
  add column if not exists claimant_message text
    check (claimant_message is null or char_length(claimant_message) <= 1000);

update cardtrade.handle_claim_requests
   set claimant_message = left(staff_notes, 1000),
       staff_notes = null
 where staff_notes is not null
   and staff_notes not like 'Verified automatically%';

-- ---------------------------------------------------------------------------
-- Claiming: 0164's fold, plus the origin stamp and closing the other requests.
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
         origin_claim_id = coalesce(origin_claim_id, new.id),
         updated_at = now()
   where target_claim_id = new.id
     and status = 'LIVE';

  update cardtrade.handle_claim_requests
     set status = 'DECLINED',
         staff_notes = coalesce(staff_notes, 'Closed automatically: the handle was claimed by another member.'),
         decided_at = now(),
         updated_at = now()
   where claim_id = new.id
     and status = 'PENDING'
     and claimant_id <> new.claimed_profile_id;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Ban or closure (0164), preferring the handle a warning was written about.
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
    select m.id, m.voucher_id, m.platform, m.sentiment, m.deal_count, m.origin_claim_id
      from cardtrade.member_references m
     where m.status = 'LIVE'
       and m.target_profile_id = new.id
     order by m.created_at
  loop
    select c.id
      into v_claim
      from cardtrade.social_claims c
     where c.claimed_profile_id = new.id
     order by (c.id = v_edge.origin_claim_id) desc nulls last,
              (c.platform = v_edge.platform) desc,
              c.claimed_at,
              c.id
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

-- ---------------------------------------------------------------------------
-- Staff remedy: release a handle claimed by the wrong member.
-- ---------------------------------------------------------------------------
create or replace function cardtrade.release_social_claim(p_claim_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner uuid;
  v_edge record;
  v_existing uuid;
  v_moved integer := 0;
begin
  select c.claimed_profile_id
    into v_owner
    from cardtrade.social_claims c
   where c.id = p_claim_id
   for update;

  if v_owner is null then
    return 0;
  end if;

  -- The references left FOR this handle go back to it; the ones left for the member
  -- directly stay with the member.
  for v_edge in
    select m.id, m.voucher_id, m.sentiment, m.deal_count
      from cardtrade.member_references m
     where m.status = 'LIVE'
       and m.target_profile_id = v_owner
       and m.origin_claim_id = p_claim_id
     order by m.created_at
  loop
    select e.id
      into v_existing
      from cardtrade.member_references e
     where e.status = 'LIVE'
       and e.target_claim_id = p_claim_id
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
             target_claim_id = p_claim_id,
             target_person_key = null,
             updated_at = now()
       where id = v_edge.id;
    end if;
    v_moved := v_moved + 1;
  end loop;

  update cardtrade.social_claims
     set claimed_profile_id = null,
         claimed_at = null,
         claim_method = 'UNCLAIMED',
         updated_at = now()
   where id = p_claim_id;

  return v_moved;
end;
$function$;

revoke all on function cardtrade.social_claims_move_references() from public, anon, authenticated;
revoke all on function cardtrade.profiles_remove_from_references() from public, anon, authenticated;
revoke all on function cardtrade.release_social_claim(uuid) from public, anon, authenticated;
grant execute on function cardtrade.release_social_claim(uuid) to service_role;
