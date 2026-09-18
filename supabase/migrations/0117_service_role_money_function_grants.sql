-- 0117_service_role_money_function_grants.sql
--
-- Grant service_role EXECUTE on the three money functions the app calls as the
-- service role and 0110 / 0088 left it unable to call.
--
-- WHAT WENT WRONG. 0110 created `record_cash_sale_payout_result` and
-- `record_cash_sale_refund_result` and, correctly, revoked them from public, anon and
-- authenticated — a member must never write a payout outcome. It never granted them to
-- service_role, and revoking PUBLIC removes the default that had been letting the
-- service role through. `apply_cash_sale_return_tracking` (called by the Ship24
-- webhook as the admin client) is in the same state for the same reason.
--
-- HOW IT PRESENTED. The hourly payout drain paid the seller through the provider,
-- called `record_cash_sale_payout_result('SETTLED')`, got `permission denied for
-- function`, and the repository discarded the error and returned null. The
-- orchestrator read null as "settled, row not returned", logged SELLER_PAYOUT_SETTLED
-- and told the seller "You were paid $1.00". The row stayed PENDING with zero
-- attempts, so the next pass found it due and did all of that again — one settlement
-- notification per hour, indefinitely. Stripe deduplicated on the persisted nonce, so
-- no money moved twice; only the bookkeeping and the inbox did.
--
-- The application side (repository throws on a rejected write; orchestrator refuses to
-- announce a settlement the row does not hold) lands in the same change, so the next
-- missing grant fails loudly on the first pass rather than quietly every hour.
--
-- Grants are stated with full signatures, as 0072 does, so an overload added later
-- does not inherit a privilege nobody reviewed.

grant execute on function cardtrade.record_cash_sale_payout_result(
  uuid, cardtrade.cash_sale_payout_status, text, text
) to service_role;

grant execute on function cardtrade.record_cash_sale_refund_result(
  uuid, cardtrade.cash_sale_payout_status, text, text
) to service_role;

do $$
declare
  sig text;
begin
  -- 0088's signature is looked up rather than repeated: the function has three
  -- overload-shaped parameters and a typo here would grant nothing while succeeding.
  select pg_get_function_identity_arguments(p.oid)
    into sig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'cardtrade' and p.proname = 'apply_cash_sale_return_tracking';

  if sig is null then
    raise exception 'cardtrade.apply_cash_sale_return_tracking not found';
  end if;

  execute format(
    'grant execute on function cardtrade.apply_cash_sale_return_tracking(%s) to service_role',
    sig
  );
end $$;
