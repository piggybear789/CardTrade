-- 0137_offers_lockdown.sql
--
-- ESC-22 (Medium): offers could be forged and revived through PostgREST.
--
--   * `update (status)` was granted to members, guarded only by a party-scoped policy,
--     so either party could set any of their offers to any status directly: revive a
--     DECLINED offer to PENDING, or mark one ACCEPTED with no contract behind it.
--   * the insert policy checked that the caller was `buyer_id` or `seller_id` and the
--     offerer, but nothing tied `seller_id` to the listing's owner. A member could
--     insert an offer naming a stranger as the seller, or one that was born ACCEPTED.
--
-- Now status changes are service-role only (`lib/actions/offers.ts`, through
-- `domain/offers/offerTransitions.ts`), and a BEFORE INSERT trigger checks every new
-- row against the listing it names. The trigger is SECURITY DEFINER because the
-- catalog policy hides some rows from the inserting member, and an invoker lookup of
-- the item could come back empty.

create or replace function cardtrade.assert_offer_parties()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from cardtrade.items where id = new.item_id;
  if v_owner is null then
    raise exception 'offer-item-missing' using errcode = '23503';
  end if;
  if new.seller_id is distinct from v_owner then
    raise exception 'offer-seller-not-owner' using errcode = '42501';
  end if;
  if new.offered_by is distinct from new.buyer_id and new.offered_by is distinct from new.seller_id then
    raise exception 'offer-offerer-not-party' using errcode = '42501';
  end if;
  -- A member's own insert: they are the offerer, and an offer is born PENDING.
  if auth.uid() is not null then
    if new.offered_by is distinct from auth.uid() then
      raise exception 'offer-offerer-not-caller' using errcode = '42501';
    end if;
    if new.status is distinct from 'PENDING'::cardtrade.offer_status then
      raise exception 'offer-not-pending' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists offers_assert_parties on cardtrade.offers;
create trigger offers_assert_parties
before insert on cardtrade.offers
for each row execute function cardtrade.assert_offer_parties();

-- The member UPDATE policy goes with the grant, so the policy set matches the grant
-- set: a policy with no grant behind it looks enabled and silently is not.
drop policy if exists offers_party_update on cardtrade.offers;

-- Grants last.
revoke update on cardtrade.offers from authenticated;
revoke update (status) on cardtrade.offers from authenticated;
revoke all on function cardtrade.assert_offer_parties() from public, anon, authenticated;
