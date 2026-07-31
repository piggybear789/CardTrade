-- Optional DittoEscrow on private deals.
--
-- Default rule stays "identity or money": verified-to-verified holds nothing.
-- Parties can still opt into collateral for high-value meetups even when both
-- are DittoShield approved. Confirming then places real Pinch holds on both
-- sides via the existing confirmDeal engagement path.
--
-- Also teach reset_deal_confirmations that changing the stake OR the opt-in
-- flag is a substantive term edit (collateral_cents was previously omitted).

alter table cardtrade.deals
  add column if not exists collateral_opt_in boolean not null default false;

comment on column cardtrade.deals.collateral_opt_in is
  'When true, both parties post deal collateral on confirm even if both are DittoShield verified.';

create or replace function cardtrade.reset_deal_confirmations()
returns trigger
language plpgsql
as $$
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
$$;
