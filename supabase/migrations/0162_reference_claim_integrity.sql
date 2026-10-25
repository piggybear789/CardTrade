-- 0162_reference_claim_integrity.sql
--
-- Claiming a handle moves the handle's references onto the claimant (0155). Fixed here:
--
-- SELF. A member could vouch for their own unclaimed handle, claim it, and have the move
-- turn that into a reference from themselves. The claimant's own references to the
-- handle now end instead of moving, and two CHECKs keep any reference from pointing at
-- its author, by account and by person.
--
-- COLLISION. Someone who had vouched for the claimant directly AND for the handle ended
-- up with two live edges for one pair of people once moved. The person-pair index
-- refused that, so the claim failed, every time. The handle's edge now folds into the
-- existing one, adding its deals.
--
-- PERSON KEY. The move took `target_person_key` from `identity_person_keys` alone and
-- left it null for a claimant with none, where `giveReference` uses `profile:<id>`.
-- `person_key_for` is the one rule now; the app sorts the keys the same way
-- (`pickPersonKey`), so both name the same person.
--
-- WHATNOT. A Whatnot username is an account a reference can be left for, so it is a
-- claim platform.

create or replace function cardtrade.person_key_for(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select k.fingerprint
       from cardtrade.identity_person_keys k
      where k.profile_id = p_profile_id
      order by (k.kind = 'document-id') desc, k.kind collate "C", k.fingerprint collate "C"
      limit 1),
    'profile:' || p_profile_id::text
  );
$function$;

revoke all on function cardtrade.person_key_for(uuid) from public, anon, authenticated;

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

  -- A voucher who already referenced the claimant with the same sentiment keeps one
  -- edge: the handle's folds into theirs.
  for v_edge in
    select m.id, m.voucher_person_key, m.sentiment, m.deal_count
      from cardtrade.member_references m
     where m.target_claim_id = new.id
       and m.status = 'LIVE'
  loop
    select e.id
      into v_existing
      from cardtrade.member_references e
     where e.status = 'LIVE'
       and e.voucher_person_key = v_edge.voucher_person_key
       and e.sentiment = v_edge.sentiment
       and (e.target_person_key = v_key or e.target_profile_id = new.claimed_profile_id)
     limit 1;

    if found then
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

alter table cardtrade.member_references
  add constraint member_references_not_self
    check (target_profile_id is null or target_profile_id <> voucher_id),
  add constraint member_references_not_self_person
    check (target_person_key is null or target_person_key <> voucher_person_key);

alter table cardtrade.social_claims
  drop constraint if exists social_claims_platform_check,
  add constraint social_claims_platform_check
    check (platform in ('instagram', 'facebook', 'x', 'youtube', 'tiktok', 'discord', 'ebay', 'whatnot'));
