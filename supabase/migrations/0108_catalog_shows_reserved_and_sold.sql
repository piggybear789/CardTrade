-- 0108_catalog_shows_reserved_and_sold.sql
--
-- The catalog's "Include sold items" filter has never done anything, and the new
-- "Include reserved items" filter could not either.
--
-- `items_catalog_select` gates the public branch on `status = 'AVAILABLE'`, so
-- Postgres refuses a RESERVED or SOLD row to anyone who is not the owner or an
-- existing counterparty. `searchCatalog` then applies its OWN status predicate on
-- top — but an application filter can only narrow what RLS already returned, never
-- widen it. So `?sold=1` has been a control that cannot change its result set,
-- which is the exact failure the `identityVerifiedOnly` filter was deleted for.
--
-- Measured before writing this, against the linked project: 8 RESERVED and 4 SOLD
-- items, all in a browsable category, none hidden, none closed, none owned by a
-- fraud-banned seller. Browsing anonymously with `?sold=1` returned only the 2
-- AVAILABLE rows. Nothing but this policy was excluding them.
--
-- WHAT CHANGES, AND WHAT DOES NOT. The public branch now admits all three
-- statuses. Every other condition is untouched: a closed shopfront, a
-- moderator-hidden listing, and a fraud-banned seller's inventory all stay out,
-- and the owner / live-counterparty branches from 0096 are preserved verbatim.
--
-- VISIBILITY MOVES TO THE APPLICATION, DELIBERATELY. RLS stops meaning "what is
-- for sale" and goes back to meaning "what you are allowed to read"; the catalog
-- decides what to ASK for. `searchCatalog` defaults to AVAILABLE only and adds
-- SOLD / RESERVED per the two Availability toggles, and the other item reads
-- (`listCatalogItems`, the search suggestions, `sitemap.ts`) already name
-- `status = 'AVAILABLE'` explicitly. Those predicates were redundant under the old
-- policy and are load-bearing under this one — do not "simplify" them away.
--
-- WHY EACH STATUS IS BROWSABLE.
--   RESERVED — a live contract that has not landed. It cannot be bought, traded
--     for, or offered on; every one of those paths guards on AVAILABLE and keeps
--     doing so. But it is not terminal: a failed trade calls `restoreItems` and a
--     failed collateral hold does the same, so the card can come back. Surfacing
--     it lets a buyer watch it and find out when it does.
--   SOLD — terminal, and useful as a price comparable. Note the figure on the card
--     is `fmv_cents`, the asking price; the settled amount lives on `cash_sales`.
--
-- TWO SIDE EFFECTS, BOTH WANTED. `/listings/[id]` stops 404ing for a stranger who
-- clicks a reserved card — the page already has the "Under Contract" badge and the
-- "Not Available" branch for exactly this, they were simply unreachable except to
-- the owner. And a watched item no longer vanishes from a member's watchlist the
-- moment it goes under contract, which is the same disappearance 0096 fixed for
-- the buyer's own listing page.
--
-- EXPOSURE. The per-row columns are the ones already public for every available
-- listing; no contact detail or KYC field is reachable through this table. What is
-- newly public is the EXISTENCE and status of non-available listings — a seller's
-- in-flight deals and sell-through history. Accepted deliberately: it is the same
-- information a marketplace's completed-sales history normally carries.

drop policy if exists items_catalog_select on cardtrade.items;
create policy items_catalog_select
  on cardtrade.items
  for select
  using (
    (
      -- 0108: was `status = 'AVAILABLE'`. The catalog query is now what decides
      -- which of these a given request wants to see.
      status in (
        'AVAILABLE'::cardtrade.item_status,
        'RESERVED'::cardtrade.item_status,
        'SOLD'::cardtrade.item_status
      )
      and closed_at is null
      -- 0091: a banned account's goods leave the catalog.
      and seller_fraud_banned = false
      -- 0094: so does a listing moderation has hidden.
      and hidden = false
    )
    -- The owner always sees their own rows, whatever state they are in.
    or owner_id = (select auth.uid())
    -- 0096: a member sees an item they have a live contract on, so the page they
    -- have money riding on does not 404 the moment it stops being for sale.
    -- Retained: it still covers a listing whose seller is later fraud-banned or
    -- whose shopfront is closed, neither of which the branch above admits.
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
