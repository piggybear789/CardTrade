-- 0071_trade_participants_can_read_bundled_items.sql
--
-- Lets the two traders in a Trade read the Items on BOTH sides of it.
--
-- THE BUG. `items_catalog_select` (the only SELECT policy on `cardtrade.items`) is
--
--     (status = 'AVAILABLE' and closed_at is null) or owner_id = auth.uid()
--
-- which is right for a catalog: availability is visibility, and an owner always sees
-- their own rows. But opening a Trade flips BOTH items to RESERVED, and neither trader
-- owns the other's. From that moment each of them could no longer read what the other
-- was putting up.
--
-- The trade room reads the bundle through the cookie-bound client, so the rows simply
-- came back missing and the exchange panel rendered its empty state:
-- **"They are putting up no goods."** — while `trade_items` held both rows, correctly
-- attributed, and the trade was asking that same trader to post collateral for them.
--
-- That is the worst shape this class of bug takes. It is not a blank space: it is a
-- confident, wrong sentence about the other side of a deal, shown at the exact moment
-- someone is deciding whether to authorise money against it. A trader could reasonably
-- cancel a good trade, or accept believing they are receiving nothing.
--
-- WHY A POLICY AND NOT A SERVICE-ROLE READ IN THE PAGE. Reading with the admin client
-- would fix this one surface and leave the next one to rediscover it — the same
-- reasoning as the project's enforce-twice convention. The right statement is that a
-- trade participant may see that trade's goods, and RLS is where that belongs.
--
-- SCOPE. Strictly the two `trades` participants, and strictly items bundled into that
-- trade. It grants nothing about any other member's inventory: an item is readable only
-- while a trade the caller is party to contains it. No new columns are exposed — this
-- is the same table and the same column grants.

-- ---------------------------------------------------------------------------
-- The policy
-- ---------------------------------------------------------------------------

drop policy if exists items_trade_participant_select on cardtrade.items;

create policy items_trade_participant_select
  on cardtrade.items
  for select
  to authenticated
  using (
    exists (
      select 1
      from cardtrade.trade_items ti
      join cardtrade.trades t on t.id = ti.trade_id
      where ti.item_id = items.id
        -- `in` over the two participant columns rather than two ORs, so adding a
        -- third party later is a one-line change rather than a new branch.
        and (select auth.uid()) in (t.initiator_id, t.counterpart_id)
    )
    -- A 1:1 trade that predates `trade_items` (0015_trade_bundles.sql) records its
    -- goods only in the two primary columns, and the trade room falls back to them.
    -- Covered here too, or those older trades keep the bug this migration removes.
    or exists (
      select 1
      from cardtrade.trades t
      where items.id in (t.initiator_item_id, t.counterpart_item_id)
        and (select auth.uid()) in (t.initiator_id, t.counterpart_id)
    )
  );

comment on policy items_trade_participant_select on cardtrade.items is
  'A Trade participant may read the Items on both sides of that Trade. Without it, '
  'opening a trade reserves both items and each trader loses sight of what the other '
  'is putting up - the exchange panel then claims they are offering nothing.';
