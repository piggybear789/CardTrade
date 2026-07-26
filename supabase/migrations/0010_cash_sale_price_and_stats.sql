-- CardTrade — 0010_cash_sale_price_and_stats.sql
-- The agreed price is a substantive term (Req 4.3): changing it must clear both
-- acceptances like any other term. Also exposes aggregate-only counterparty
-- reputation counts so a contract room can show who it is dealing with without
-- widening read access to other people's sales.

-- Renegotiating price re-opens the contract for both parties.
drop trigger if exists cash_sales_reset_acceptances on cardtrade.cash_sales;
create trigger cash_sales_reset_acceptances
before update of fulfillment_method, shipping_cost_cents, shipping_notes,
  delivery_address, meeting_location, meeting_at, agreed_price_cents
on cardtrade.cash_sales
for each row execute function cardtrade.reset_cash_sale_acceptances();

-- Aggregate counts only. No amounts, no counterparties, no item identifiers, so
-- this discloses nothing an RLS-protected sale row would otherwise hide.
create or replace function cardtrade.member_sale_stats(p_profile_id uuid)
returns table (completed_sales integer, completed_purchases integer)
language sql
security definer
stable
set search_path = ''
as $$
  select
    (select count(*)::integer from cardtrade.cash_sales
      where seller_id = p_profile_id and status = 'COMPLETED'),
    (select count(*)::integer from cardtrade.cash_sales
      where buyer_id = p_profile_id and status = 'COMPLETED');
$$;

revoke all on function cardtrade.member_sale_stats(uuid) from public, anon;
grant execute on function cardtrade.member_sale_stats(uuid) to authenticated, service_role;

comment on function cardtrade.member_sale_stats(uuid) is
  'Aggregate completed sale/purchase counts for reputation display. Security definer by design: counts only, never row detail.';
