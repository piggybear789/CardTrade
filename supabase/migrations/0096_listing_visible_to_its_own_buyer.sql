-- 0096_listing_visible_to_its_own_buyer.sql
--
-- A buyer with a live contract could not see the listing they were buying.
--
-- `items_catalog_select` grants an item to everyone when it is AVAILABLE, and to its owner
-- always. Opening a contract on a SINGLE listing flips it to RESERVED — so from that
-- moment the BUYER, who is neither the owner nor looking at an AVAILABLE row, was refused
-- by RLS and `/listings/[id]` returned 404.
--
-- A bookmark, a shared link, a watchlist entry or the browser back button all land there.
-- The buyer has money in escrow against that item and the listing page tells them it does
-- not exist.
--
-- The fix is narrow: a member may see an item they hold a LIVE CONTRACT on. Not any past
-- contract — a terminated one confers no reason to keep seeing a withdrawn listing — and
-- not any other member's contract.
--
-- WHY AN EXISTS AND NOT A FUNCTION. 0091 tried a SECURITY DEFINER helper for a similar
-- job and `grants.test.ts` correctly refused it, because a function taking an id and
-- granted to `anon` is a probe. This needs no function: `cash_sales` and `trades` already
-- grant SELECT to `authenticated` under participant-scoped RLS, so the subquery sees
-- exactly the caller's own contracts and nothing else. For `anon` there is no `auth.uid()`,
-- so the branch is simply false.

drop policy if exists items_catalog_select on cardtrade.items;
create policy items_catalog_select
  on cardtrade.items
  for select
  using (
    (
      status = 'AVAILABLE'::cardtrade.item_status
      and closed_at is null
      -- 0091: a banned account's goods leave the catalog.
      and seller_fraud_banned = false
      -- 0094: so does a listing moderation has hidden.
      and hidden = false
    )
    -- The owner always sees their own rows, whatever state they are in.
    or owner_id = (select auth.uid())
    -- NEW: a member sees an item they have a live contract on, so the page they have
    -- money riding on does not 404 the moment it stops being for sale.
    or exists (
      select 1
      from cardtrade.cash_sales sale
      where sale.item_id = items.id
        and sale.buyer_id = (select auth.uid())
        and sale.status not in (
          'COMPLETED'::cardtrade.cash_sale_status,
          'CANCELLED'::cardtrade.cash_sale_status,
          'FAILED'::cardtrade.cash_sale_status,
          'REFUNDED'::cardtrade.cash_sale_status
        )
    )
    or exists (
      select 1
      from cardtrade.trades trade
      where (trade.initiator_item_id = items.id or trade.counterpart_item_id = items.id)
        and (
          trade.initiator_id = (select auth.uid())
          or trade.counterpart_id = (select auth.uid())
        )
        and trade.state not in (
          'COMPLETED'::cardtrade.trade_state,
          'CANCELLED'::cardtrade.trade_state,
          'FRAUD_RESOLVED'::cardtrade.trade_state
        )
    )
  );

-- ---------------------------------------------------------------------------
-- The double-sell backstop had stopped counting two states as active.
-- ---------------------------------------------------------------------------
--
-- `cash_sales_one_active_per_item` forbids two live contracts on a SINGLE listing, and
-- `cash_sales_one_active_per_shopfront_buyer` forbids one buyer holding two on the same
-- binder. Both list the active statuses explicitly, and neither was updated when 0088
-- added `RETURN_PENDING` and `RETURN_IN_TRANSIT` — so a sale awaiting returned goods was
-- treated as finished by the constraint that exists to prevent double-selling.
--
-- NOT currently exploitable: the item stays RESERVED for the whole return, and
-- `initiateCashSale` refuses anything that is not AVAILABLE. The index is the BACKSTOP for
-- when that guard is wrong, which is exactly when it needs to be right. Same shape as the
-- refund-queuing bug in 0090 and the custody list: an enumeration written before a state
-- existed, silently no longer covering everything it names.
drop index if exists cardtrade.cash_sales_one_active_per_item;
create unique index cash_sales_one_active_per_item
  on cardtrade.cash_sales (item_id)
  where from_shopfront = false
    and status in (
      'AGREEMENT'::cardtrade.cash_sale_status,
      'PAYMENT_PENDING'::cardtrade.cash_sale_status,
      'ESCROW_HELD'::cardtrade.cash_sale_status,
      'IN_TRANSIT'::cardtrade.cash_sale_status,
      'HANDOVER'::cardtrade.cash_sale_status,
      'INSPECTION'::cardtrade.cash_sale_status,
      'DISPUTED'::cardtrade.cash_sale_status,
      'RETURN_PENDING'::cardtrade.cash_sale_status,
      'RETURN_IN_TRANSIT'::cardtrade.cash_sale_status
    );

drop index if exists cardtrade.cash_sales_one_active_per_shopfront_buyer;
create unique index cash_sales_one_active_per_shopfront_buyer
  on cardtrade.cash_sales (item_id, buyer_id)
  where from_shopfront = true
    and status in (
      'AGREEMENT'::cardtrade.cash_sale_status,
      'PAYMENT_PENDING'::cardtrade.cash_sale_status,
      'ESCROW_HELD'::cardtrade.cash_sale_status,
      'IN_TRANSIT'::cardtrade.cash_sale_status,
      'HANDOVER'::cardtrade.cash_sale_status,
      'INSPECTION'::cardtrade.cash_sale_status,
      'DISPUTED'::cardtrade.cash_sale_status,
      'RETURN_PENDING'::cardtrade.cash_sale_status,
      'RETURN_IN_TRANSIT'::cardtrade.cash_sale_status
    );
