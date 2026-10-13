-- 0135_return_details_lockdown.sql
--
-- ESC-13 (High): a BUYER could take over their own sale's return address.
--
-- 0088 granted `authenticated` INSERT and UPDATE on `cash_sale_return_details`, with
-- policies that only checked `seller_id = auth.uid()`. `seller_id` is a column the
-- writer supplies, so a buyer could insert the row for their own sale with
-- themselves as `seller_id` before the seller did, read it back as the seller's
-- address, and post the "return" to themselves. Carrier-confirmed delivery then
-- released the full refund automatically.
--
-- Now:
--   * members cannot write the table at all. `saveCashSaleReturnAddress` checks that
--     the caller is the sale's seller and writes with the service role;
--   * a trigger ties every row to the sale it belongs to: `seller_id` must be that
--     sale's seller, and the sale must be in a state where a return address is owed;
--   * the member INSERT / UPDATE policies go with the grants, so the policy set
--     still matches the grant set (a policy with no grant behind it looks enabled
--     and is not).
--
-- No data is deleted. Rows written before this migration are left for staff: the
-- ops checklist has the query that finds any whose `seller_id` is not the sale's
-- seller.

create or replace function cardtrade.cash_sale_return_details_assert_seller()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller uuid;
  v_status cardtrade.cash_sale_status;
begin
  -- FOR SHARE so a status change cannot race the check.
  select seller_id, status into v_seller, v_status
  from cardtrade.cash_sales
  where id = new.cash_sale_id
  for share;

  if v_seller is null then
    raise exception 'return-details-sale-not-found' using errcode = '23503';
  end if;
  if new.seller_id is distinct from v_seller then
    raise exception 'return-details-not-seller' using errcode = '42501';
  end if;
  if v_status not in ('RETURN_PENDING', 'RETURN_IN_TRANSIT', 'DISPUTED') then
    raise exception 'return-details-not-owed' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists cash_sale_return_details_assert_seller on cardtrade.cash_sale_return_details;
create trigger cash_sale_return_details_assert_seller
before insert or update on cardtrade.cash_sale_return_details
for each row execute function cardtrade.cash_sale_return_details_assert_seller();

drop policy if exists cash_sale_return_details_seller_insert on cardtrade.cash_sale_return_details;
drop policy if exists cash_sale_return_details_seller_update on cardtrade.cash_sale_return_details;

-- Grants last.
revoke insert, update on cardtrade.cash_sale_return_details from authenticated;
revoke all on function cardtrade.cash_sale_return_details_assert_seller() from public, anon, authenticated;
