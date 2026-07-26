-- 0020_deal_party_contributions.sql
-- Bilateral evidence for private deals: each participant owns an item
-- description and photo set. Photo changes are substantive terms, so they clear
-- both confirmations. Ownership is enforced below RLS to prevent one party
-- overwriting the other's evidence.

alter table cardtrade.deals
  add column if not exists counterparty_photo_paths text[] not null default '{}';

-- Existing creators already supplied photos + a description during deal setup.
-- Move that description into their owned side so old trades render coherently.
update cardtrade.deals
set creator_item_text = description
where creator_item_text is null
  and description is not null
  and cardinality(creator_photo_paths) > 0;

create or replace function cardtrade.guard_deal_contribution_ownership()
returns trigger
language plpgsql
security definer
set search_path = cardtrade, auth
as $$
declare
  v_user_id uuid := auth.uid();
begin
  -- Service-role/provider writes have no end-user uid and remain permitted.
  if v_user_id is null then
    return new;
  end if;

  if v_user_id = old.creator_id then
    if new.counterparty_item_text is distinct from old.counterparty_item_text
       or new.counterparty_photo_paths is distinct from old.counterparty_photo_paths then
      raise exception 'Participants may only change their own deal contribution';
    end if;
  elsif v_user_id = old.counterparty_id then
    if new.creator_item_text is distinct from old.creator_item_text
       or new.creator_photo_paths is distinct from old.creator_photo_paths then
      raise exception 'Participants may only change their own deal contribution';
    end if;
  else
    raise exception 'Only deal participants may update contributions';
  end if;

  return new;
end;
$$;

drop trigger if exists deals_guard_contribution_ownership on cardtrade.deals;
create trigger deals_guard_contribution_ownership
before update on cardtrade.deals
for each row execute function cardtrade.guard_deal_contribution_ownership();

create or replace function cardtrade.reset_deal_photo_confirmations()
returns trigger
language plpgsql
security definer
set search_path = cardtrade
as $$
begin
  if new.creator_photo_paths is distinct from old.creator_photo_paths
     or new.counterparty_photo_paths is distinct from old.counterparty_photo_paths then
    new.creator_confirmed_at := null;
    new.counterparty_confirmed_at := null;
    new.terms_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists deals_reset_photo_confirmations on cardtrade.deals;
create trigger deals_reset_photo_confirmations
before update on cardtrade.deals
for each row execute function cardtrade.reset_deal_photo_confirmations();