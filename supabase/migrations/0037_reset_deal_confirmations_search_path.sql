-- 0037_reset_deal_confirmations_search_path.sql
--
-- Pins `search_path` on cardtrade.reset_deal_confirmations.
--
-- It was the only CardTrade function flagged by the Supabase security linter
-- (0011_function_search_path_mutable). A trigger function with a role-mutable
-- search_path resolves unqualified names against whatever the CALLER's path
-- happens to be, so a schema shadowing a referenced object can change what the
-- function does. This one only touches NEW/OLD fields and now(), so the current
-- risk is low — but it is a trigger on the deal terms that CLEARS both parties'
-- confirmations, which is exactly the kind of consent-tracking logic that should
-- not be able to shift underneath us.
--
-- Body is unchanged; only the search_path setting is added.

create or replace function cardtrade.reset_deal_confirmations()
returns trigger
language plpgsql
set search_path to 'cardtrade', 'pg_temp'
as $function$
begin
  if (new.handover_method      is distinct from old.handover_method)
  or (new.meeting_location     is distinct from old.meeting_location)
  or (new.meeting_at           is distinct from old.meeting_at)
  or (new.delivery_details     is distinct from old.delivery_details)
  or (new.delivery_cost_cents  is distinct from old.delivery_cost_cents)
  or (new.cash_amount_cents    is distinct from old.cash_amount_cents)
  or (new.cash_payer_id        is distinct from old.cash_payer_id)
  or (new.collateral_cents     is distinct from old.collateral_cents)
  or (new.collateral_opt_in    is distinct from old.collateral_opt_in)
  or (new.creator_item_id      is distinct from old.creator_item_id)
  or (new.counterparty_item_id is distinct from old.counterparty_item_id)
  or (new.creator_item_text    is distinct from old.creator_item_text)
  or (new.counterparty_item_text is distinct from old.counterparty_item_text)
  or (new.title                is distinct from old.title)
  or (new.description          is distinct from old.description)
  then
    new.creator_confirmed_at := null;
    new.counterparty_confirmed_at := null;
    new.terms_updated_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$function$;
